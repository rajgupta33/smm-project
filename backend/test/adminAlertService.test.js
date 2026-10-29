const assert = require('node:assert/strict');
const test = require('node:test');
const AdminAlert = require('../models/AdminAlert');
const {
    acknowledgeAlert,
    raiseAlert,
    resolveAlert,
    resolveAlertByAdmin,
    summarizeActiveAlerts,
} = require('../services/adminAlertService');

function matches(row, filter) {
    return Object.entries(filter).every(([key, expected]) => row[key] === expected);
}

function alertStore() {
    const rows = [];
    const audits = [];
    let nextId = 1;
    let failNextUpsertWithDuplicate = false;
    const AlertModel = {
        async findOneAndUpdate(filter, update, options = {}) {
            if (failNextUpsertWithDuplicate) {
                failNextUpsertWithDuplicate = false;
                rows.push({ _id: `alert-${nextId++}`, occurrences: 1, ...update.$setOnInsert, ...update.$set });
                throw Object.assign(new Error('duplicate key'), { code: 11000 });
            }
            const existing = rows.find((row) => matches(row, filter));
            if (!existing) {
                if (!options.upsert) return null;
                const row = { _id: `alert-${nextId++}`, occurrences: 0, ...update.$setOnInsert, ...update.$set };
                row.occurrences += update.$inc?.occurrences || 0;
                rows.push(row);
                return options.new ? row : null;
            }
            const before = { ...existing };
            Object.assign(existing, update.$set || {});
            for (const [key, amount] of Object.entries(update.$inc || {})) existing[key] = (existing[key] || 0) + amount;
            return options.new ? existing : before;
        },
        async updateOne(filter, update) {
            const row = rows.find((candidate) => matches(candidate, filter));
            if (!row) return { modifiedCount: 0 };
            Object.assign(row, update.$set);
            return { modifiedCount: 1 };
        },
        async findById(id) {
            return rows.find((row) => row._id === id) || null;
        },
        async aggregate() {
            const groups = new Map();
            for (const row of rows.filter((candidate) => candidate.active)) {
                const key = `${row.severity}:${row.status}`;
                const group = groups.get(key) || { _id: { severity: row.severity, status: row.status }, count: 0 };
                group.count += 1;
                groups.set(key, group);
            }
            return [...groups.values()];
        },
    };
    return {
        rows,
        audits,
        failNextUpsertWithDuplicate: () => { failNextUpsertWithDuplicate = true; },
        overrides: {
            AdminAlert: AlertModel,
            AuditLog: { async create(entry) { audits.push(entry); } },
            mongoose: { isValidObjectId: () => true },
        },
    };
}

const lowBalance = (overrides = {}) => ({
    type: 'PROVIDER_LOW_BALANCE',
    severity: 'WARNING',
    dedupeKey: 'provider-low-balance:provider-1',
    title: 'Main panel balance is running low',
    message: 'Current balance is ₹1,500.00.',
    targetType: 'Provider',
    targetId: 'provider-1',
    ...overrides,
});

test('a recurring condition updates one alert instead of opening duplicates', async () => {
    const store = alertStore();
    const first = await raiseAlert(lowBalance({ now: new Date('2026-09-14T10:00:00Z') }), store.overrides);
    const second = await raiseAlert(lowBalance({ now: new Date('2026-09-14T10:30:00Z') }), store.overrides);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].occurrences, 2);
    assert.equal(store.rows[0].status, 'OPEN');
    assert.deepEqual(store.rows[0].firstSeenAt, new Date('2026-09-14T10:00:00Z'));
    assert.deepEqual(store.rows[0].lastSeenAt, new Date('2026-09-14T10:30:00Z'));
});

test('an acknowledged alert reopens only when its severity escalates', async () => {
    const store = alertStore();
    await raiseAlert(lowBalance(), store.overrides);
    store.rows[0].status = 'ACKNOWLEDGED';

    await raiseAlert(lowBalance(), store.overrides);
    assert.equal(store.rows[0].status, 'ACKNOWLEDGED');

    const escalated = await raiseAlert(lowBalance({ severity: 'CRITICAL' }), store.overrides);
    assert.equal(escalated.escalated, true);
    assert.equal(store.rows[0].status, 'OPEN');
    assert.equal(store.rows[0].severity, 'CRITICAL');
});

test('a resolved condition that returns opens a fresh alert', async () => {
    const store = alertStore();
    await raiseAlert(lowBalance(), store.overrides);
    const resolved = await resolveAlert({ dedupeKey: 'provider-low-balance:provider-1' }, store.overrides);
    assert.equal(resolved.resolved, 1);
    assert.equal(store.rows[0].active, false);
    assert.equal(store.rows[0].resolutionKind, 'AUTO');

    await raiseAlert(lowBalance(), store.overrides);
    assert.equal(store.rows.length, 2);
    assert.equal(store.rows[1].active, true);
});

test('a concurrent insert of the same alert is retried as an update', async () => {
    const store = alertStore();
    store.failNextUpsertWithDuplicate();
    const result = await raiseAlert(lowBalance(), store.overrides);
    assert.equal(result.created, false);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].occurrences, 2);
});

test('alerts reject unknown severities and missing text', async () => {
    const store = alertStore();
    await assert.rejects(() => raiseAlert(lowBalance({ severity: 'LOUD' }), store.overrides), /severity/);
    await assert.rejects(() => raiseAlert(lowBalance({ title: '  ' }), store.overrides), /title is required/);
});

test('admin acknowledgement and resolution are audited once and replay safely', async () => {
    const store = alertStore();
    await raiseAlert(lowBalance(), store.overrides);
    const alertId = store.rows[0]._id;
    const input = { alertId, actorId: 'admin-1', requestId: 'request-1' };

    const acknowledged = await acknowledgeAlert(input, store.overrides);
    const replay = await acknowledgeAlert(input, store.overrides);
    assert.equal(acknowledged.changed, true);
    assert.equal(replay.changed, false);
    assert.equal(store.rows[0].status, 'ACKNOWLEDGED');

    const resolved = await resolveAlertByAdmin({ ...input, requestId: 'request-2' }, store.overrides);
    assert.equal(resolved.changed, true);
    assert.equal(store.rows[0].active, false);
    assert.equal(store.rows[0].resolutionKind, 'ADMIN');
    assert.deepEqual(store.audits.map((entry) => entry.action), ['ADMIN_ALERT_ACKNOWLEDGED', 'ADMIN_ALERT_RESOLVED']);
});

test('admin actions on a missing alert return not found', async () => {
    const store = alertStore();
    await assert.rejects(
        () => acknowledgeAlert({ alertId: 'missing', actorId: 'admin-1', requestId: 'request-1' }, store.overrides),
        (error) => error.statusCode === 404 && error.code === 'ALERT_NOT_FOUND'
    );
});

test('active alert summary separates unacknowledged and severity counts', async () => {
    const store = alertStore();
    await raiseAlert(lowBalance({ severity: 'CRITICAL' }), store.overrides);
    await raiseAlert(lowBalance({ dedupeKey: 'provider-low-balance:provider-2' }), store.overrides);
    store.rows[1].status = 'ACKNOWLEDGED';
    assert.deepEqual(await summarizeActiveAlerts(store.overrides), {
        total: 2, open: 1, critical: 1, warning: 1, info: 0,
    });
});

test('AdminAlert declares a unique dedupe key only among unresolved alerts', () => {
    const [, options] = AdminAlert.schema.indexes().find(([fields]) => fields.dedupeKey === 1);
    assert.equal(options.unique, true);
    assert.deepEqual(options.partialFilterExpression, { active: true });
});
