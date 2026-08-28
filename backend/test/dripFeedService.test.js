const assert = require('node:assert/strict');
const { test } = require('node:test');
const DripFeedOrder = require('../models/DripFeedOrder');
const DripFeedRun = require('../models/DripFeedRun');
const {
    allocatedRunAmount,
    createDripFeedSchedule,
    processDripFeedRun,
} = require('../services/dripFeedService');

function matches(state, filter) {
    return Object.entries(filter).every(([key, expected]) => {
        const actual = state[key];
        if (expected && typeof expected === 'object' && '$in' in expected) {
            return expected.$in.includes(actual);
        }
        return actual === expected;
    });
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

function applyUpdate(state, update) {
    for (const [path, value] of Object.entries(update.$set || {})) setPath(state, path, value);
    for (const [path, value] of Object.entries(update.$inc || {})) setPath(state, path, state[path] + value);
    return state;
}

function harness(providerResult, options = {}) {
    const parent = {
        _id: 'parent-1', orderId: 'order-1', totalQuantity: 300,
        quantityPerRun: 100, totalRuns: 3, completedRuns: options.completedRuns || 0,
        intervalMinutes: 30, reservedAmountMinor: 1000,
        acceptedAmountMinor: options.acceptedAmountMinor || 0,
        refundedAmountMinor: 0, status: 'ACTIVE', nextRunAt: new Date(),
    };
    const runNumber = options.runNumber || 1;
    const run = {
        _id: `run-${runNumber}`, parentId: parent._id, runNumber, quantity: 100,
        scheduledAt: new Date(), allocatedAmountMinor: allocatedRunAmount(1000, 3, runNumber),
        status: options.runStatus || 'SCHEDULED', attemptCount: options.runStatus === 'SUBMITTING' ? 1 : 0,
        attempt: options.runStatus === 'SUBMITTING' ? { outcome: 'STARTED' } : null,
    };
    const order = {
        _id: 'order-1', localOrderId: 'ord-1', orderId: 'ord-1', user: 'user-1',
        providerServiceId: 'provider-service-1', target: 'https://example.com/post',
        quantity: 300, lifecycleStatus: 'DRIP_FEED', fundingStatus: 'DEBITED',
        pricingSnapshot: { sellingTotalMinor: 1000 },
    };
    const runs = new Map([[run._id, run]]);
    const dispatches = [];
    let providerCalls = 0;
    let refundAmount = 0;
    const model = (state) => ({
        async findById(id) { return id === state._id ? state : null; },
        async findOneAndUpdate(filter, update) {
            if (!matches(state, filter)) return null;
            return applyUpdate(state, update);
        },
        async updateOne(filter, update) {
            if (!matches(state, filter)) return { modifiedCount: 0 };
            applyUpdate(state, update);
            return { modifiedCount: 1 };
        },
    });
    const runModel = {
        ...model(run),
        async findById(id) { return runs.get(id) || null; },
        async create(documents) {
            return documents.map((document, index) => {
                const created = { ...document, _id: `created-run-${runs.size + index}` };
                runs.set(created._id, created);
                return created;
            });
        },
    };
    const session = { async withTransaction(operation) { await operation(); }, async endSession() {} };
    const dependencies = {
        mongoose: { async startSession() { return session; } },
        DripFeedOrder: model(parent),
        DripFeedRun: runModel,
        Order: model(order),
        providerAdapter: {
            async placeOrder(input) {
                providerCalls += 1;
                assert.equal(input.quantity, 100);
                return providerResult;
            },
        },
        async createDispatch(document) { dispatches.push(document); },
        async appendOrderEvent() {},
        async refundWallet(input) { refundAmount += input.amountMinor; return { created: true }; },
    };
    return {
        parent, run, order, runs, dispatches, dependencies,
        counts: () => ({ providerCalls, refundAmount }),
    };
}

test('integer paise allocation is deterministic and sums exactly to the parent charge', () => {
    const allocations = [1, 2, 3].map((runNumber) => allocatedRunAmount(1000, 3, runNumber));
    assert.deepEqual(allocations, [334, 333, 333]);
    assert.equal(allocations.reduce((total, value) => total + value, 0), 1000);
});

test('schedule creation writes parent, first run, and outbox through one caller session', async () => {
    const session = { id: 'mongo-session' };
    const calls = [];
    const Parent = {
        async create(documents, options) {
            calls.push({ type: 'parent', options });
            return [{ ...documents[0], _id: 'parent-id' }];
        },
    };
    const Run = {
        async create(documents, options) {
            calls.push({ type: 'run', options });
            return [{ ...documents[0], _id: 'run-id' }];
        },
    };
    const result = await createDripFeedSchedule({
        order: {
            _id: 'order-id', quantity: 300, providerId: null, providerOfferId: null,
            pricingSnapshot: { sellingTotalMinor: 1000 },
        },
        quantityPerRun: 100,
        totalRuns: 3,
        intervalMinutes: 30,
        session,
    }, {
        DripFeedOrder: Parent,
        DripFeedRun: Run,
        async createDispatch(document, receivedSession) {
            calls.push({ type: 'dispatch', document, receivedSession });
        },
        now: new Date('2026-08-29T00:00:00.000Z'),
    });
    assert.deepEqual(calls.slice(0, 2).map((call) => call.options.session), [session, session]);
    assert.equal(calls[2].receivedSession, session);
    assert.equal(result.run.status, 'SCHEDULED');
    assert.equal(result.dispatchDocument.jobKey, 'drip:parent-id:1');
    assert.equal(result.dispatchDocument.payload.runId, 'run-id');
});

test('accepted run is submitted once and creates only the next durable delayed run', async () => {
    const context = harness({ classification: 'ACCEPTED', providerOrderId: 'provider-order-1' });
    const result = await processDripFeedRun(context.run._id, context.dependencies);
    assert.equal(result.runStatus, 'SUBMITTED');
    assert.equal(context.run.providerOrderId, 'provider-order-1');
    assert.equal(context.parent.completedRuns, 1);
    assert.equal(context.parent.acceptedAmountMinor, 334);
    assert.equal(context.dispatches.length, 1);
    assert.equal(context.dispatches[0].jobKey, 'drip:parent-1:2');
    assert.equal(context.runs.size, 2);

    await processDripFeedRun(context.run._id, context.dependencies);
    assert.equal(context.counts().providerCalls, 1);
});

test('final accepted run completes the parent without creating another dispatch', async () => {
    const context = harness({
        classification: 'ACCEPTED', providerOrderId: 'provider-order-3',
    }, { runNumber: 3, completedRuns: 2, acceptedAmountMinor: 667 });
    const result = await processDripFeedRun(context.run._id, context.dependencies);
    assert.equal(result.lifecycleStatus, 'COMPLETED');
    assert.equal(context.parent.status, 'COMPLETED');
    assert.equal(context.parent.completedRuns, 3);
    assert.equal(context.parent.acceptedAmountMinor, 1000);
    assert.equal(context.order.lifecycleStatus, 'COMPLETED');
    assert.equal(context.dispatches.length, 0);
});

test('ambiguous provider result pauses parent and order without retry or refund', async () => {
    const context = harness({
        classification: 'AMBIGUOUS', failureKind: 'TIMEOUT', errorMessage: 'Provider timed out',
    });
    const result = await processDripFeedRun(context.run._id, context.dependencies);
    assert.equal(result.lifecycleStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(context.run.status, 'RECONCILIATION_REQUIRED');
    assert.equal(context.parent.status, 'RECONCILIATION_REQUIRED');
    assert.equal(context.order.lifecycleStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(context.counts().refundAmount, 0);

    await processDripFeedRun(context.run._id, context.dependencies);
    assert.equal(context.counts().providerCalls, 1);
});

test('definitive rejection refunds only current and future unexecuted allocations', async () => {
    const context = harness({
        classification: 'DEFINITIVE_REJECTION',
        failureKind: 'PROVIDER_REJECTION',
        errorMessage: 'Invalid target',
    }, { runNumber: 2, completedRuns: 1, acceptedAmountMinor: 334 });
    const result = await processDripFeedRun(context.run._id, context.dependencies);
    assert.equal(result.lifecycleStatus, 'CANCELLED');
    assert.equal(result.refundAmountMinor, 666);
    assert.equal(context.counts().refundAmount, 666);
    assert.equal(context.parent.status, 'CANCELLED');
    assert.equal(context.order.fundingStatus, 'PARTIALLY_REFUNDED');
});

test('an interrupted claimed run requires reconciliation without a second provider call', async () => {
    const context = harness({ classification: 'ACCEPTED' }, { runStatus: 'SUBMITTING' });
    const result = await processDripFeedRun(context.run._id, context.dependencies);
    assert.equal(result.lifecycleStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(context.run.attempt.failureKind, 'INTERRUPTED_ATTEMPT');
    assert.equal(context.counts().providerCalls, 0);
});

test('drip-feed models protect schedule uniqueness and operational lookup indexes', () => {
    assert.ok(DripFeedOrder.schema.indexes().some(([keys]) => keys.status === 1 && keys.nextRunAt === 1));
    const runIndexes = DripFeedRun.schema.indexes();
    assert.ok(runIndexes.some(([keys, options]) => keys.parentId === 1 && keys.runNumber === 1 && options.unique));
    assert.ok(runIndexes.some(([keys, options]) => keys.providerId === 1 && keys.providerOrderId === 1 && options.unique));
    assert.ok(runIndexes.some(([keys]) => keys.status === 1 && keys.scheduledAt === 1));
});
