const assert = require('node:assert/strict');
const { test } = require('node:test');
const ManualTask = require('../models/ManualTask');
const {
    ManualTaskError,
    claimManualTask,
    updateManualTask,
} = require('../services/manualTaskService');

const IDS = {
    task: '507f1f77bcf86cd799439011',
    admin: '507f1f77bcf86cd799439012',
    otherAdmin: '507f1f77bcf86cd799439013',
    order: '507f1f77bcf86cd799439014',
    user: '507f1f77bcf86cd799439015',
};

function harness({ taskStatus = 'PENDING', assignedTo = null } = {}) {
    const events = [];
    const refunds = [];
    const sessions = [];
    const task = {
        _id: IDS.task,
        orderId: IDS.order,
        assignedTo,
        status: taskStatus,
        notes: '',
        proof: '',
        dueAt: null,
        claimedAt: null,
        resolvedAt: null,
        async save(options) {
            assert.ok(options.session);
            return this;
        },
    };
    const order = {
        _id: IDS.order,
        user: IDS.user,
        localOrderId: 'ord_manual_1',
        orderId: 'ord_manual_1',
        lifecycleStatus: 'MANUAL_PROCESSING',
        fundingStatus: 'DEBITED',
        lastStatus: 'Pending Manual Fulfilment',
        pricingSnapshot: { sellingTotalMinor: 12500 },
        async save(options) {
            assert.ok(options.session);
            return this;
        },
    };
    const query = (value) => ({ async session() { return value; } });
    const dependencies = {
        mongoose: {
            isValidObjectId: () => true,
            async startSession() {
                const session = {
                    async withTransaction(operation) { await operation(); },
                    async endSession() { this.ended = true; },
                };
                sessions.push(session);
                return session;
            },
        },
        ManualTask: {
            async findOneAndUpdate(filter, update, options) {
                assert.ok(options.session);
                if (task.status !== filter.status || task.assignedTo !== filter.assignedTo) return null;
                Object.assign(task, update.$set);
                return task;
            },
            findById(id) { return query(id === IDS.task ? task : null); },
        },
        Order: {
            findById(id) { return query(id === IDS.order ? order : null); },
        },
        async appendOrderEvent(event) {
            assert.ok(event.session);
            events.push(event);
        },
        async refundWallet(input) {
            assert.ok(input.session);
            refunds.push(input);
            return { created: true };
        },
        now: () => new Date('2026-08-29T12:00:00.000Z'),
    };
    return { dependencies, events, order, refunds, sessions, task };
}

test('manual task claim is atomic, owned by the current admin, and idempotent for that admin', async () => {
    const context = harness();
    const first = await claimManualTask({ taskId: IDS.task, adminId: IDS.admin }, context.dependencies);
    assert.equal(first.idempotentReplay, false);
    assert.equal(context.task.status, 'ASSIGNED');
    assert.equal(context.task.assignedTo, IDS.admin);
    assert.equal(context.events.length, 1);

    const replay = await claimManualTask({ taskId: IDS.task, adminId: IDS.admin }, context.dependencies);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(context.events.length, 1);

    await assert.rejects(
        claimManualTask({ taskId: IDS.task, adminId: IDS.otherAdmin }, context.dependencies),
        (error) => error instanceof ManualTaskError && error.code === 'MANUAL_TASK_ALREADY_CLAIMED'
    );
    assert.ok(context.sessions.every((session) => session.ended));
});

test('manual task transitions update the order and append customer-safe status events', async () => {
    const context = harness({ taskStatus: 'ASSIGNED', assignedTo: IDS.admin });
    await updateManualTask({
        taskId: IDS.task,
        adminId: IDS.admin,
        status: 'IN_PROGRESS',
        notes: 'Started securely',
        dueAt: '2026-08-30T12:00:00.000Z',
    }, context.dependencies);
    assert.equal(context.task.status, 'IN_PROGRESS');
    assert.equal(context.order.lastStatus, 'In progress');
    assert.equal(context.events[0].metadata.newStatus, 'IN_PROGRESS');
    assert.equal('notes' in context.events[0].metadata, false);

    await updateManualTask({
        taskId: IDS.task,
        adminId: IDS.admin,
        status: 'COMPLETED',
        proof: 'https://evidence.example/proof/1',
    }, context.dependencies);
    assert.equal(context.task.status, 'COMPLETED');
    assert.equal(context.order.lifecycleStatus, 'COMPLETED');
    assert.equal(context.order.fundingStatus, 'DEBITED');
    assert.equal(context.refunds.length, 0);
});

test('manual rejection refunds once and terminal retries cannot duplicate the credit', async () => {
    const context = harness({ taskStatus: 'IN_PROGRESS', assignedTo: IDS.admin });
    const first = await updateManualTask({
        taskId: IDS.task,
        adminId: IDS.admin,
        status: 'REJECTED',
    }, context.dependencies);
    assert.equal(first.idempotentReplay, false);
    assert.equal(context.order.lifecycleStatus, 'CANCELLED');
    assert.equal(context.order.fundingStatus, 'REFUNDED');
    assert.equal(context.refunds.length, 1);
    assert.equal(context.refunds[0].idempotencyKey, 'order-refund-manual:ord_manual_1');

    const replay = await updateManualTask({
        taskId: IDS.task,
        adminId: IDS.admin,
        status: 'REJECTED',
    }, context.dependencies);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(context.refunds.length, 1);

    await assert.rejects(
        updateManualTask({
            taskId: IDS.task,
            adminId: IDS.admin,
            status: 'COMPLETED',
        }, context.dependencies),
        (error) => error.code === 'MANUAL_TASK_ALREADY_RESOLVED'
    );
});

test('manual task transitions enforce assignment, sequence, and bounded HTTP proof', async () => {
    const assigned = harness({ taskStatus: 'ASSIGNED', assignedTo: IDS.admin });
    await assert.rejects(
        updateManualTask({ taskId: IDS.task, adminId: IDS.admin, status: 'COMPLETED' }, assigned.dependencies),
        (error) => error.code === 'INVALID_MANUAL_TASK_TRANSITION'
    );
    await assert.rejects(
        updateManualTask({ taskId: IDS.task, adminId: IDS.otherAdmin, status: 'IN_PROGRESS' }, assigned.dependencies),
        (error) => error.code === 'MANUAL_TASK_FORBIDDEN'
    );
    await assert.rejects(
        updateManualTask({ taskId: IDS.task, adminId: IDS.admin, proof: 'javascript:alert(1)' }, assigned.dependencies),
        (error) => error.code === 'INVALID_MANUAL_TASK_REQUEST'
    );
});

test('ManualTask protects workflow fields and operational indexes', () => {
    const notes = ManualTask.schema.path('notes');
    const proof = ManualTask.schema.path('proof');
    assert.ok(notes.validators.some((validator) => validator.maxlength === 4000));
    assert.ok(proof.validators.some((validator) => validator.maxlength === 2000));
    assert.equal(ManualTask.schema.options.optimisticConcurrency, true);
    assert.ok(ManualTask.schema.indexes().some(([keys]) => keys.status === 1 && keys.dueAt === 1));
});
