const assert = require('node:assert/strict');
const test = require('node:test');
const { submitCommittedOrder } = require('../services/orderSubmissionService');
const Order = require('../models/Order');

function setPath(target, path, value) {
    const parts = path.split('.');
    let cursor = target;
    for (const part of parts.slice(0, -1)) {
        cursor[part] ||= {};
        cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
}

function matches(state, filter) {
    return Object.entries(filter).every(([key, expected]) => {
        const actual = state[key];
        if (expected && typeof expected === 'object' && '$in' in expected) {
            return expected.$in.includes(actual);
        }
        return actual === expected;
    });
}

function harness(providerResult, { failAcceptancePersistence = false } = {}) {
    const state = {
        _id: 'order-db-id',
        localOrderId: 'ord_local',
        orderId: 'ord_local',
        user: 'user-db-id',
        providerServiceId: 'provider-service-1',
        target: 'https://example.com/post',
        quantity: 5000,
        lifecycleStatus: 'INTENT_COMMITTED',
        fundingStatus: 'DEBITED',
        submissionAttempt: null,
        pricingSnapshot: { sellingTotalMinor: 62500 },
    };
    let providerCalls = 0;
    let refunds = 0;
    let acceptedUpdateAttempted = false;

    const applyUpdate = (update) => {
        for (const [path, value] of Object.entries(update.$set || {})) setPath(state, path, value);
        return state;
    };
    const Order = {
        async findOneAndUpdate(filter, update) {
            if (!matches(state, filter)) return null;
            if (update.$set?.lifecycleStatus === 'SUBMITTED') {
                acceptedUpdateAttempted = true;
                if (failAcceptancePersistence) throw new Error('database unavailable');
            }
            return applyUpdate(update);
        },
        async updateOne(filter, update) {
            if (!matches(state, filter)) return { modifiedCount: 0 };
            applyUpdate(update);
            return { modifiedCount: 1 };
        },
    };
    const fakeSession = {
        async withTransaction(operation) { await operation(); },
        async endSession() {},
    };
    const dependencies = {
        Order,
        mongoose: { async startSession() { return fakeSession; } },
        providerClient: {
            async submitOrder() {
                providerCalls += 1;
                return providerResult;
            },
        },
        async refundWallet(input) {
            assert.equal(input.idempotencyKey, 'order-refund:ord_local');
            refunds += 1;
            return { created: true };
        },
        async appendOrderEvent() {},
    };
    return {
        state,
        dependencies,
        counts: () => ({ providerCalls, refunds, acceptedUpdateAttempted }),
    };
}

test('accepted order is submitted once and an already-claimed order is never resubmitted', async () => {
    const context = harness({
        classification: 'ACCEPTED', providerOrderId: 'provider-order-9', httpStatus: 200,
    });
    const first = await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(first.lifecycleStatus, 'SUBMITTED');
    assert.equal(context.state.providerOrderId, 'provider-order-9');
    assert.equal(context.counts().providerCalls, 1);

    const replay = await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(replay.alreadyClaimed, true);
    assert.equal(context.counts().providerCalls, 1);
});

test('order submission resolves the adapter from the provider selected at order creation', async () => {
    const context = harness({ classification: 'ACCEPTED', providerOrderId: 'provider-order-2' });
    context.state.providerId = 'provider-db-id';
    delete context.dependencies.providerClient;
    let selectedCredential = false;
    let selectedProvider;
    context.dependencies.Provider = {
        findById(id) {
            assert.equal(id, 'provider-db-id');
            return {
                async select(selection) {
                    selectedCredential = selection === '+credentialReference';
                    return {
                        _id: id, enabled: true, adapterType: 'LEGACY_SMM',
                        apiBaseUrl: 'https://second.invalid',
                        credentialReference: 'env:SECOND_KEY', timeoutMs: 5000,
                    };
                },
            };
        },
    };
    context.dependencies.getProviderAdapterForProvider = (provider) => {
        selectedProvider = provider;
        return {
            async placeOrder() {
                return { classification: 'ACCEPTED', providerOrderId: 'provider-order-2' };
            },
        };
    };
    context.dependencies.recordProviderMetric = async () => {};
    const result = await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(result.lifecycleStatus, 'SUBMITTED');
    assert.equal(selectedCredential, true);
    assert.equal(selectedProvider.apiBaseUrl, 'https://second.invalid');
});

test('definitive rejection atomically refunds and records rejected state', async () => {
    const context = harness({
        classification: 'DEFINITIVE_REJECTION',
        failureKind: 'PROVIDER_REJECTION',
        errorMessage: 'Invalid target',
    });
    const result = await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(result.lifecycleStatus, 'PROVIDER_REJECTED');
    assert.equal(context.state.fundingStatus, 'REFUNDED');
    assert.equal(context.counts().refunds, 1);
});

test('ambiguous timeout requires reconciliation and never refunds or retries', async () => {
    const context = harness({
        classification: 'AMBIGUOUS', failureKind: 'TIMEOUT', errorMessage: 'Timed out',
    });
    const result = await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(result.lifecycleStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(context.state.fundingStatus, 'DEBITED');
    assert.equal(context.counts().refunds, 0);

    await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(context.counts().providerCalls, 1);
});

test('acceptance followed by local persistence failure becomes reconciliation-required', async () => {
    const context = harness(
        { classification: 'ACCEPTED', providerOrderId: 'provider-order-accepted' },
        { failAcceptancePersistence: true }
    );
    const result = await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(context.counts().acceptedUpdateAttempted, true);
    assert.equal(result.lifecycleStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(context.state.lifecycleStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(context.counts().providerCalls, 1);
    assert.equal(context.counts().refunds, 0);
});

test('an interrupted claimed attempt is reconciled without another provider call', async () => {
    const context = harness({
        classification: 'ACCEPTED', providerOrderId: 'must-not-be-used',
    });
    context.state.lifecycleStatus = 'SUBMITTING';
    context.state.submissionAttempt = {
        attemptNumber: 1, startedAt: new Date(), outcome: 'STARTED',
    };
    const result = await submitCommittedOrder(context.state, context.dependencies);
    assert.equal(result.lifecycleStatus, 'RECONCILIATION_REQUIRED');
    assert.equal(context.state.submissionAttempt.failureKind, 'INTERRUPTED_ATTEMPT');
    assert.equal(context.counts().providerCalls, 0);
    assert.equal(context.counts().refunds, 0);
});

test('Order declares reconciliation and provider lookup indexes', () => {
    const indexes = Order.schema.indexes();
    const localId = indexes.find(([keys]) => keys.localOrderId === 1);
    const providerId = indexes.find(([keys]) => keys.providerOrderId === 1);
    assert.equal(localId[1].unique, true);
    assert.equal(localId[1].sparse, true);
    assert.equal(providerId[1].unique, true);
    assert.equal(providerId[1].sparse, true);
    assert.ok(indexes.some(([keys]) => keys.lifecycleStatus === 1 && keys.updatedAt === 1));
});
