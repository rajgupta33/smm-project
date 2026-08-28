const mongoose = require('mongoose');
const ManualTask = require('../models/ManualTask');
const Order = require('../models/Order');
const { appendOrderEvent } = require('./orderEventService');
const { refundWallet } = require('./walletService');

const MANUAL_TASK_STATUSES = [
    'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_APPROVAL',
    'COMPLETED', 'REJECTED', 'CANCELLED',
];
const TERMINAL_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);
const TRANSITIONS = new Map([
    ['ASSIGNED', new Set(['IN_PROGRESS', 'REJECTED', 'CANCELLED'])],
    ['IN_PROGRESS', new Set(['AWAITING_APPROVAL', 'COMPLETED', 'REJECTED', 'CANCELLED'])],
    ['AWAITING_APPROVAL', new Set(['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'])],
]);

class ManualTaskError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'ManualTaskError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function dependencies(overrides = {}) {
    return {
        mongoose,
        ManualTask,
        Order,
        appendOrderEvent,
        refundWallet,
        now: () => new Date(),
        ...overrides,
    };
}

function requireObjectId(value, field, deps) {
    if (!deps.mongoose.isValidObjectId(value)) {
        throw new ManualTaskError(`${field} is invalid`, 'INVALID_MANUAL_TASK_REQUEST');
    }
    return value;
}

function normalizeText(value, field, maximum) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new ManualTaskError(`${field} must be text`, 'INVALID_MANUAL_TASK_REQUEST');
    }
    const normalized = value.trim();
    if (normalized.length > maximum) {
        throw new ManualTaskError(`${field} is too long`, 'INVALID_MANUAL_TASK_REQUEST');
    }
    return normalized;
}

function normalizeProof(value) {
    const proof = normalizeText(value, 'proof', 2000);
    if (proof === undefined || proof === '') return proof;
    let parsed;
    try {
        parsed = new URL(proof);
    } catch {
        throw new ManualTaskError('proof must be a valid HTTP(S) URL', 'INVALID_MANUAL_TASK_REQUEST');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new ManualTaskError('proof must be a valid HTTP(S) URL', 'INVALID_MANUAL_TASK_REQUEST');
    }
    return parsed.toString();
}

function normalizeDueAt(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const dueAt = new Date(value);
    if (Number.isNaN(dueAt.getTime())) {
        throw new ManualTaskError('dueAt must be a valid date', 'INVALID_MANUAL_TASK_REQUEST');
    }
    return dueAt;
}

function normalizeStatus(value) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !MANUAL_TASK_STATUSES.includes(value.toUpperCase())) {
        throw new ManualTaskError('status is invalid', 'INVALID_MANUAL_TASK_STATUS');
    }
    return value.toUpperCase();
}

function sameValue(current, requested) {
    if (requested === undefined) return true;
    if (requested instanceof Date) {
        return new Date(current).getTime() === requested.getTime();
    }
    return (current ?? '') === requested;
}

function assertTransition(currentStatus, nextStatus) {
    if (nextStatus === undefined || nextStatus === currentStatus) return;
    if (currentStatus === 'PENDING') {
        throw new ManualTaskError('Claim the task before updating it', 'MANUAL_TASK_NOT_CLAIMED', 409);
    }
    if (!TRANSITIONS.get(currentStatus)?.has(nextStatus)) {
        throw new ManualTaskError(
            `Manual task cannot move from ${currentStatus} to ${nextStatus}`,
            'INVALID_MANUAL_TASK_TRANSITION',
            409
        );
    }
}

async function claimManualTask({ taskId, adminId }, overrides = {}) {
    const deps = dependencies(overrides);
    requireObjectId(taskId, 'taskId', deps);
    requireObjectId(adminId, 'adminId', deps);
    const session = await deps.mongoose.startSession();
    try {
        let task;
        let idempotentReplay = false;
        await session.withTransaction(async () => {
            task = await deps.ManualTask.findOneAndUpdate(
                { _id: taskId, status: 'PENDING', assignedTo: null },
                {
                    $set: {
                        assignedTo: adminId,
                        status: 'ASSIGNED',
                        claimedAt: deps.now(),
                    },
                },
                { new: true, runValidators: true, session }
            );
            if (!task) {
                const existing = await deps.ManualTask.findById(taskId).session(session);
                if (!existing) {
                    throw new ManualTaskError('Manual task not found', 'MANUAL_TASK_NOT_FOUND', 404);
                }
                if (existing.status === 'ASSIGNED' && String(existing.assignedTo) === String(adminId)) {
                    task = existing;
                    idempotentReplay = true;
                    return;
                }
                throw new ManualTaskError('Manual task has already been claimed', 'MANUAL_TASK_ALREADY_CLAIMED', 409);
            }
            const order = await deps.Order.findById(task.orderId).session(session);
            if (!order || order.lifecycleStatus !== 'MANUAL_PROCESSING') {
                throw new ManualTaskError('Manual order is not available for fulfilment', 'MANUAL_ORDER_INVALID_STATE', 409);
            }
            await deps.appendOrderEvent({
                orderId: order._id,
                userId: order.user,
                eventType: 'STATUS_CHANGED',
                metadata: { oldStatus: 'PENDING', newStatus: 'ASSIGNED' },
                session,
            });
        });
        return { task, idempotentReplay };
    } finally {
        await session.endSession();
    }
}

async function updateManualTask({ taskId, adminId, status, notes, proof, dueAt }, overrides = {}) {
    const deps = dependencies(overrides);
    requireObjectId(taskId, 'taskId', deps);
    requireObjectId(adminId, 'adminId', deps);
    const requested = {
        status: normalizeStatus(status),
        notes: normalizeText(notes, 'notes', 4000),
        proof: normalizeProof(proof),
        dueAt: normalizeDueAt(dueAt),
    };
    if (Object.values(requested).every((value) => value === undefined)) {
        throw new ManualTaskError('At least one manual task field is required', 'INVALID_MANUAL_TASK_REQUEST');
    }

    const session = await deps.mongoose.startSession();
    try {
        let task;
        let idempotentReplay = false;
        await session.withTransaction(async () => {
            task = await deps.ManualTask.findById(taskId).session(session);
            if (!task) throw new ManualTaskError('Manual task not found', 'MANUAL_TASK_NOT_FOUND', 404);
            if (!task.assignedTo) {
                throw new ManualTaskError('Claim the task before updating it', 'MANUAL_TASK_NOT_CLAIMED', 409);
            }
            if (String(task.assignedTo) !== String(adminId)) {
                throw new ManualTaskError('Manual task is assigned to another administrator', 'MANUAL_TASK_FORBIDDEN', 403);
            }

            const unchanged = (requested.status === undefined || requested.status === task.status)
                && sameValue(task.notes, requested.notes)
                && sameValue(task.proof, requested.proof)
                && sameValue(task.dueAt, requested.dueAt);
            if (unchanged) {
                idempotentReplay = true;
                return;
            }
            if (TERMINAL_STATUSES.has(task.status)) {
                throw new ManualTaskError('Resolved manual tasks are immutable', 'MANUAL_TASK_ALREADY_RESOLVED', 409);
            }
            assertTransition(task.status, requested.status);

            const order = await deps.Order.findById(task.orderId).session(session);
            if (!order || order.lifecycleStatus !== 'MANUAL_PROCESSING' || order.fundingStatus !== 'DEBITED') {
                throw new ManualTaskError('Manual order is not in a mutable funded state', 'MANUAL_ORDER_INVALID_STATE', 409);
            }

            if (requested.notes !== undefined) task.notes = requested.notes;
            if (requested.proof !== undefined) task.proof = requested.proof;
            if (requested.dueAt !== undefined) task.dueAt = requested.dueAt;

            if (requested.status !== undefined && requested.status !== task.status) {
                const previousStatus = task.status;
                task.status = requested.status;
                if (requested.status === 'COMPLETED') {
                    task.resolvedAt = deps.now();
                    order.lifecycleStatus = 'COMPLETED';
                    order.lastStatus = 'Completed';
                } else if (requested.status === 'REJECTED' || requested.status === 'CANCELLED') {
                    await deps.refundWallet({
                        userId: order.user,
                        amountMinor: order.pricingSnapshot.sellingTotalMinor,
                        type: 'REFUND',
                        sourceType: 'ORDER',
                        sourceId: order.localOrderId || order.orderId,
                        idempotencyKey: `order-refund-manual:${order.localOrderId || order.orderId}`,
                        actorType: 'ADMIN',
                        actorId: adminId,
                        description: `Refund for manually ${requested.status.toLowerCase()} order ${order.localOrderId || order.orderId}`,
                        session,
                    });
                    task.resolvedAt = deps.now();
                    order.lifecycleStatus = 'CANCELLED';
                    order.fundingStatus = 'REFUNDED';
                    order.lastStatus = requested.status === 'REJECTED' ? 'Rejected' : 'Cancelled';
                    await deps.appendOrderEvent({
                        orderId: order._id,
                        userId: order.user,
                        eventType: 'REFUND_COMPLETED',
                        metadata: {
                            amountMinor: order.pricingSnapshot.sellingTotalMinor,
                            reason: `MANUAL_${requested.status}`,
                        },
                        session,
                    });
                } else {
                    order.lastStatus = requested.status === 'IN_PROGRESS'
                        ? 'In progress'
                        : 'Awaiting approval';
                }
                await deps.appendOrderEvent({
                    orderId: order._id,
                    userId: order.user,
                    eventType: 'STATUS_CHANGED',
                    metadata: { oldStatus: previousStatus, newStatus: requested.status },
                    session,
                });
                await order.save({ session });
            }
            await task.save({ session });
        });
        return { task, idempotentReplay };
    } finally {
        await session.endSession();
    }
}

module.exports = {
    MANUAL_TASK_STATUSES,
    ManualTaskError,
    claimManualTask,
    updateManualTask,
};
