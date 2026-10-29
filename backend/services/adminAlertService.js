const mongoose = require('mongoose');
const AdminAlert = require('../models/AdminAlert');
const AuditLog = require('../models/AuditLog');

const SEVERITY_RANK = { INFO: 1, WARNING: 2, CRITICAL: 3 };
const ALERT_VIEWS = ['active', 'resolved', 'all'];

class AdminAlertError extends Error {
    constructor(message, code = 'ADMIN_ALERT_FAILED', statusCode = 400) {
        super(message);
        this.name = 'AdminAlertError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function dependencies(overrides = {}) {
    return { AdminAlert, AuditLog, mongoose, ...overrides };
}

function requireText(value, fieldName, maxLength) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new AdminAlertError(`${fieldName} is required`, 'INVALID_ALERT');
    }
    return value.trim().slice(0, maxLength);
}

/**
 * Opens an alert, or refreshes the unresolved alert that shares its dedupeKey.
 * An acknowledged alert is reopened only when its severity escalates, so a
 * condition the admin already knows about does not keep demanding attention.
 */
async function raiseAlert(input, overrides = {}) {
    const { AdminAlert: AlertModel } = dependencies(overrides);
    if (!SEVERITY_RANK[input?.severity]) {
        throw new AdminAlertError('Alert severity is invalid', 'INVALID_ALERT');
    }
    const now = input.now || new Date();
    const dedupeKey = requireText(input.dedupeKey, 'dedupeKey', 300);
    const filter = { dedupeKey, active: true };
    const update = {
        $setOnInsert: {
            type: input.type,
            dedupeKey,
            active: true,
            status: 'OPEN',
            firstSeenAt: now,
            targetType: input.targetType || null,
            targetId: input.targetId || null,
        },
        $set: {
            severity: input.severity,
            title: requireText(input.title, 'title', 200),
            message: requireText(input.message, 'message', 2000),
            metadata: input.metadata ?? null,
            lastSeenAt: now,
        },
        $inc: { occurrences: 1 },
    };
    const options = { upsert: true, new: false, setDefaultsOnInsert: false, runValidators: true };

    let previous;
    try {
        previous = await AlertModel.findOneAndUpdate(filter, update, options);
    } catch (error) {
        // Two writers raced to insert the same alert; the loser updates the winner's row.
        if (error?.code !== 11000) throw error;
        previous = await AlertModel.findOneAndUpdate(filter, update, options);
    }

    const escalated = Boolean(previous)
        && SEVERITY_RANK[input.severity] > (SEVERITY_RANK[previous.severity] || 0);
    if (escalated && previous.status === 'ACKNOWLEDGED') {
        await AlertModel.updateOne(
            { _id: previous._id, status: 'ACKNOWLEDGED' },
            { $set: { status: 'OPEN', acknowledgedAt: null, acknowledgedBy: null } }
        );
    }
    return { created: !previous, escalated };
}

/** Closes the unresolved alert for a condition that has cleared on its own. */
async function resolveAlert({ dedupeKey, now = new Date() }, overrides = {}) {
    const { AdminAlert: AlertModel } = dependencies(overrides);
    const result = await AlertModel.updateOne(
        { dedupeKey: requireText(dedupeKey, 'dedupeKey', 300), active: true },
        { $set: { active: false, status: 'RESOLVED', resolvedAt: now, resolutionKind: 'AUTO' } }
    );
    return { resolved: result?.modifiedCount || 0 };
}

function assertAlertId(mongooseLib, alertId) {
    if (!mongooseLib.isValidObjectId(alertId)) {
        throw new AdminAlertError('Alert ID is invalid', 'INVALID_ALERT_ID');
    }
}

async function transitionByAdmin({ alertId, actorId, requestId, now = new Date() }, transition, overrides) {
    const deps = dependencies(overrides);
    assertAlertId(deps.mongoose, alertId);
    const alert = await deps.AdminAlert.findOneAndUpdate(
        { _id: alertId, ...transition.filter },
        { $set: transition.update(now, actorId) },
        { new: true }
    );
    if (!alert) {
        const existing = await deps.AdminAlert.findById(alertId);
        if (!existing) throw new AdminAlertError('Alert not found', 'ALERT_NOT_FOUND', 404);
        return { alert: existing, changed: false };
    }
    await deps.AuditLog.create({
        action: transition.action,
        actorType: 'ADMIN',
        actorId,
        targetType: 'AdminAlert',
        targetId: String(alert._id),
        requestId: requireText(requestId, 'requestId', 200),
        before: transition.before,
        after: { status: alert.status },
        metadata: { type: alert.type, dedupeKey: alert.dedupeKey },
    });
    return { alert, changed: true };
}

function acknowledgeAlert(input, overrides = {}) {
    return transitionByAdmin(input, {
        action: 'ADMIN_ALERT_ACKNOWLEDGED',
        filter: { status: 'OPEN' },
        before: { status: 'OPEN' },
        update: (now, actorId) => ({ status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedBy: actorId }),
    }, overrides);
}

function resolveAlertByAdmin(input, overrides = {}) {
    return transitionByAdmin(input, {
        action: 'ADMIN_ALERT_RESOLVED',
        filter: { active: true },
        before: { active: true },
        update: (now, actorId) => ({
            active: false, status: 'RESOLVED', resolvedAt: now, resolvedBy: actorId, resolutionKind: 'ADMIN',
        }),
    }, overrides);
}

function sortBySeverity(alerts) {
    return [...alerts].sort((left, right) => (
        (SEVERITY_RANK[right.severity] || 0) - (SEVERITY_RANK[left.severity] || 0)
        || new Date(right.lastSeenAt) - new Date(left.lastSeenAt)
    ));
}

async function listAlerts({ view = 'active', limit = 100 } = {}, overrides = {}) {
    const { AdminAlert: AlertModel } = dependencies(overrides);
    if (!ALERT_VIEWS.includes(view)) {
        throw new AdminAlertError('Alert view is invalid', 'INVALID_ALERT_VIEW');
    }
    const filter = view === 'active' ? { active: true } : view === 'resolved' ? { active: false } : {};
    const alerts = await AlertModel.find(filter)
        .sort({ lastSeenAt: -1 })
        .limit(Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 200))
        .lean();
    return view === 'active' ? sortBySeverity(alerts) : alerts;
}

async function summarizeActiveAlerts(overrides = {}) {
    const { AdminAlert: AlertModel } = dependencies(overrides);
    const rows = await AlertModel.aggregate([
        { $match: { active: true } },
        { $group: { _id: { severity: '$severity', status: '$status' }, count: { $sum: 1 } } },
    ]);
    const summary = { total: 0, open: 0, critical: 0, warning: 0, info: 0 };
    for (const row of rows) {
        summary.total += row.count;
        if (row._id.status === 'OPEN') summary.open += row.count;
        const severity = String(row._id.severity || '').toLowerCase();
        if (severity in summary) summary[severity] += row.count;
    }
    return summary;
}

module.exports = {
    AdminAlertError,
    SEVERITY_RANK,
    acknowledgeAlert,
    listAlerts,
    raiseAlert,
    resolveAlert,
    resolveAlertByAdmin,
    sortBySeverity,
    summarizeActiveAlerts,
};
