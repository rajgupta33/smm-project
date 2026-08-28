const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const OrderReconciliation = require('../models/OrderReconciliation');
const { resolveOrderReconciliation } = require('../services/orderReconciliationService');

const ids = {
    order: '507f1f77bcf86cd799439011',
    user: '507f1f77bcf86cd799439012',
    admin: '507f1f77bcf86cd799439013',
    parent: '507f1f77bcf86cd799439014',
    run: '507f1f77bcf86cd799439015',
};

function query(value) {
    return { session() { return Promise.resolve(value); } };
}

function setPath(target, path, value) {
    const parts = path.split('.');
    let cursor = target;
    for (const part of parts.slice(0, -1)) {
        cursor[part] ||= {};
        cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
}

function applyUpdate(target, update) {
    for (const [path, value] of Object.entries(update.$set || {})) setPath(target, path, value);
    for (const [path, value] of Object.entries(update.$inc || {})) setPath(target, path, (target[path] || 0) + value);
    return target;
}

function harness({ dripFeed = false, finalRun = false, replay = null } = {}) {
    const order = {
        _id: new mongoose.Types.ObjectId(ids.order),
        localOrderId: 'ord-reconcile-1',
        orderId: 'ord-reconcile-1',
        user: new mongoose.Types.ObjectId(ids.user),
        lifecycleStatus: 'RECONCILIATION_REQUIRED',
        fundingStatus: 'DEBITED',
        providerId: new mongoose.Types.ObjectId(),
        providerOfferId: new mongoose.Types.ObjectId(),
        pricingSnapshot: { sellingTotalMinor: 1000 },
        submissionAttempt: { attemptNumber: 1, startedAt: new Date(), outcome: 'AMBIGUOUS' },
    };
    const parent = dripFeed ? {
        _id: new mongoose.Types.ObjectId(ids.parent), orderId: order._id,
        totalRuns: finalRun ? 2 : 3, completedRuns: 1, quantityPerRun: 100,
        intervalMinutes: 60, reservedAmountMinor: 1000, acceptedAmountMinor: 300,
        refundedAmountMinor: 0, status: 'RECONCILIATION_REQUIRED',
    } : null;
    const run = dripFeed ? {
        _id: new mongoose.Types.ObjectId(ids.run), parentId: parent._id,
        runNumber: 2, quantity: 100, allocatedAmountMinor: 300,
        status: 'RECONCILIATION_REQUIRED', attemptCount: 1,
        attempt: { startedAt: new Date(), outcome: 'AMBIGUOUS' },
    } : null;
    const refunds = [];
    const events = [];
    const audits = [];
    const reconciliations = [];
    const dispatches = [];
    const createdRuns = [];
    const session = {
        async withTransaction(operation) { await operation(); },
        async endSession() { this.ended = true; },
    };
    const dependencies = {
        mongoose: { isValidObjectId: mongoose.isValidObjectId, async startSession() { return session; } },
        Order: {
            findById() { return query(order); },
            async findOneAndUpdate(filter, update) {
                if (String(filter._id) !== String(order._id)
                    || filter.lifecycleStatus !== order.lifecycleStatus
                    || (filter.fundingStatus && filter.fundingStatus !== order.fundingStatus)) return null;
                return applyUpdate(order, update);
            },
        },
        DripFeedOrder: {
            findOne() { return query(parent); },
            async findOneAndUpdate(filter, update) {
                if (!parent || String(filter._id) !== String(parent._id) || filter.status !== parent.status) return null;
                if (filter.completedRuns !== undefined && filter.completedRuns !== parent.completedRuns) return null;
                return applyUpdate(parent, update);
            },
        },
        DripFeedRun: {
            find() { return query(run ? [run] : []); },
            async findOneAndUpdate(filter, update) {
                if (!run || String(filter._id) !== String(run._id) || filter.status !== run.status) return null;
                return applyUpdate(run, update);
            },
            async create(documents) {
                const value = { _id: new mongoose.Types.ObjectId(), ...documents[0] };
                createdRuns.push(value);
                return [value];
            },
        },
        OrderReconciliation: {
            findOne(filter) {
                return query(filter.resolvedBy ? replay : null);
            },
            async create(documents) {
                const value = { _id: new mongoose.Types.ObjectId(), ...documents[0] };
                reconciliations.push(value);
                return [value];
            },
        },
        async refundWallet(input) { refunds.push(input); return { created: true }; },
        async appendOrderEvent(input) { events.push(input); },
        AuditLog: { async create(entries) { audits.push(entries[0]); } },
        async createDispatch(document) { dispatches.push(document); },
    };
    return {
        order, parent, run, refunds, events, audits, reconciliations,
        dispatches, createdRuns, session, dependencies,
    };
}

function input(overrides = {}) {
    return {
        orderId: ids.order,
        actorId: ids.admin,
        requestId: 'reconcile-request-1',
        resolution: 'CONFIRMED_ACCEPTED',
        providerOrderId: 'provider-confirmed-77',
        evidenceNote: 'Verified in the provider order history using the target and quantity.',
        evidenceUrl: 'https://provider.example/orders/77',
        ...overrides,
    };
}

test('confirmed provider acceptance records the provider ID without a second submission or refund', async () => {
    const context = harness();
    const result = await resolveOrderReconciliation(input(), context.dependencies);

    assert.equal(result.order.lifecycleStatus, 'SUBMITTED');
    assert.equal(result.order.providerOrderId, 'provider-confirmed-77');
    assert.equal(result.order.fundingStatus, 'DEBITED');
    assert.equal(context.refunds.length, 0);
    assert.equal(context.reconciliations[0].resolution, 'CONFIRMED_ACCEPTED');
    assert.equal(context.events[0].eventType, 'RECONCILIATION_RESOLVED');
    assert.equal(context.audits[0].action, 'ORDER_RECONCILIATION_RESOLVED');
    assert.equal(context.session.ended, true);
});

test('confirmed non-acceptance refunds the authoritative order amount exactly once in the transaction', async () => {
    const context = harness();
    const result = await resolveOrderReconciliation(input({
        resolution: 'CONFIRMED_NOT_ACCEPTED',
        providerOrderId: null,
    }), context.dependencies);

    assert.equal(result.order.lifecycleStatus, 'PROVIDER_REJECTED');
    assert.equal(result.order.fundingStatus, 'REFUNDED');
    assert.equal(context.refunds.length, 1);
    assert.equal(context.refunds[0].amountMinor, 1000);
    assert.equal(context.refunds[0].idempotencyKey, 'reconciliation-refund:ord-reconcile-1');
    assert.equal(context.refunds[0].session, context.session);
    assert.equal(result.reconciliation.refundAmountMinor, 1000);
});

test('legacy orders without an authoritative price snapshot cannot be refunded from browser-era fields', async () => {
    const context = harness();
    context.order.pricingSnapshot = null;
    context.order.rate = 999999;
    await assert.rejects(
        resolveOrderReconciliation(input({
            resolution: 'CONFIRMED_NOT_ACCEPTED', providerOrderId: null,
        }), context.dependencies),
        (error) => error.code === 'INVALID_REFUND_AMOUNT' && error.statusCode === 409
    );
    assert.equal(context.refunds.length, 0);
});

test('confirmed drip-feed acceptance resumes with only the next scheduled run', async () => {
    const context = harness({ dripFeed: true });
    const result = await resolveOrderReconciliation(input(), context.dependencies);

    assert.equal(result.order.lifecycleStatus, 'DRIP_FEED');
    assert.equal(context.run.status, 'SUBMITTED');
    assert.equal(context.parent.status, 'ACTIVE');
    assert.equal(context.parent.completedRuns, 2);
    assert.equal(context.createdRuns.length, 1);
    assert.equal(context.createdRuns[0].runNumber, 3);
    assert.equal(context.dispatches.length, 1);
    assert.match(context.dispatches[0].jobKey, /^drip:/);
    assert.equal(context.refunds.length, 0);
});

test('confirmed drip-feed non-acceptance cancels future work and refunds only unexecuted value', async () => {
    const context = harness({ dripFeed: true });
    const result = await resolveOrderReconciliation(input({
        resolution: 'CONFIRMED_NOT_ACCEPTED', providerOrderId: null,
    }), context.dependencies);

    assert.equal(result.order.lifecycleStatus, 'CANCELLED');
    assert.equal(result.order.fundingStatus, 'PARTIALLY_REFUNDED');
    assert.equal(context.parent.status, 'CANCELLED');
    assert.equal(context.run.status, 'REJECTED');
    assert.equal(context.refunds[0].amountMinor, 700);
    assert.equal(context.createdRuns.length, 0);
});

test('idempotent replay returns the recorded result and performs no mutation', async () => {
    const replay = {
        _id: new mongoose.Types.ObjectId(), orderId: new mongoose.Types.ObjectId(ids.order),
        resolution: 'CONFIRMED_ACCEPTED', providerOrderId: 'provider-confirmed-77',
        refundAmountMinor: 0,
    };
    const context = harness({ replay });
    context.order.lifecycleStatus = 'SUBMITTED';
    const result = await resolveOrderReconciliation(input(), context.dependencies);

    assert.equal(result.idempotentReplay, true);
    assert.equal(context.reconciliations.length, 0);
    assert.equal(context.events.length, 0);
    assert.equal(context.refunds.length, 0);
});

test('reconciliation model protects one immutable resolution per order and request', () => {
    const indexes = OrderReconciliation.schema.indexes();
    assert.ok(indexes.some(([keys, options]) => keys.orderId === 1 && options.unique));
    assert.ok(indexes.some(([keys, options]) => keys.resolvedBy === 1 && keys.requestId === 1 && options.unique));

    const invalid = new OrderReconciliation({
        orderId: ids.order, workflowKind: 'STANDARD', resolution: 'CONFIRMED_ACCEPTED',
        providerOrderId: 'provider-1', evidenceNote: 'sufficient evidence note',
        evidenceUrl: 'http://unsafe.example/proof', resolvedBy: ids.admin, requestId: 'request-1',
    }).validateSync();
    assert.ok(invalid.errors.evidenceUrl);
});
