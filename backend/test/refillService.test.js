const assert = require('node:assert/strict');
const test = require('node:test');

const RefillRequest = require('../models/RefillRequest');
const {
    createRefillRequest, evaluateEligibility, mapProviderRefillStatus, submitRefillRequest,
} = require('../services/refillService');

function query(value) {
    return {
        sort() { return this; },
        select() { return this; },
        session: async () => value,
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function eligibilityDependencies({ offerOverrides = {}, active = null, previous = null } = {}) {
    let refillReads = 0;
    return {
        config: { defaultGuaranteeDays: 30, cooldownHours: 24, statusPollMinutes: 5 },
        ProviderOffer: {
            findOne: () => query({
                _id: 'offer-1', providerId: 'provider-1', providerServiceId: '100',
                supportsRefill: true, availability: 'AVAILABLE', catalogueServiceId: null,
                ...offerOverrides,
            }),
        },
        CatalogueService: { findById: () => query(null) },
        Provider: {
            findById: () => query({ _id: 'provider-1', enabled: true, healthStatus: 'HEALTHY' }),
        },
        RefillRequest: {
            findOne() {
                refillReads += 1;
                return query(refillReads === 1 ? active : previous);
            },
        },
    };
}

function eligibleOrder(overrides = {}) {
    return {
        _id: 'order-1', orderId: 'ord_public', localOrderId: 'ord_public',
        providerOrderId: 'provider-order-1', providerServiceId: '100',
        lifecycleStatus: 'SUBMITTED', lastStatus: 'Completed', refill: '',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        refillGuaranteeUntil: new Date('2026-09-01T00:00:00Z'),
        ...overrides,
    };
}

test('refill model protects active requests, idempotency, and provider refill identity', () => {
    const indexes = RefillRequest.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.activeOrderKey === 1 && options.unique && options.sparse));
    assert.ok(indexes.some(([fields, options]) => fields.userId === 1 && fields.idempotencyKey === 1 && options.unique));
    assert.ok(indexes.some(([fields, options]) => fields.providerRefillId === 1 && options.unique && options.sparse));
    assert.equal(RefillRequest.schema.path('eligibilitySnapshot').options.immutable, true);
});

test('eligibility captures ownership-resolved order, provider support, status, and guarantee', async () => {
    const now = new Date('2026-08-20T00:00:00Z');
    const result = await evaluateEligibility(
        { order: eligibleOrder(), now, session: {} }, eligibilityDependencies()
    );
    assert.equal(result.providerOrderId, 'provider-order-1');
    assert.equal(result.snapshot.supportsRefill, true);
    assert.equal(result.snapshot.orderStatus, 'Completed');
    assert.equal(result.snapshot.providerEligibilityCheck, 'DEFERRED_TO_SUBMISSION');
});

test('eligibility rejects unsupported, expired, ineligible, active, and cooldown requests', async () => {
    const now = new Date('2026-08-20T00:00:00Z');
    const cases = [
        [eligibleOrder({ lastStatus: 'Pending' }), eligibilityDependencies(), 'REFILL_STATUS_INELIGIBLE'],
        [eligibleOrder({ refillGuaranteeUntil: new Date('2026-08-19') }), eligibilityDependencies(), 'REFILL_GUARANTEE_EXPIRED'],
        [eligibleOrder(), eligibilityDependencies({ offerOverrides: { supportsRefill: false } }), 'REFILL_UNSUPPORTED'],
        [eligibleOrder(), eligibilityDependencies({ active: { _id: 'active-1' } }), 'REFILL_ALREADY_ACTIVE'],
        [eligibleOrder(), eligibilityDependencies({ previous: { cooldownUntil: new Date('2026-08-21') } }), 'REFILL_COOLDOWN_ACTIVE'],
    ];
    for (const [order, deps, code] of cases) {
        await assert.rejects(
            evaluateEligibility({ order, now, session: {} }, deps),
            (error) => error.code === code,
            code
        );
    }
});

test('creating a refill scopes the order to the authenticated user and writes the outbox in one transaction', async () => {
    const order = eligibleOrder();
    const offer = {
        _id: 'offer-1', providerId: 'provider-1', supportsRefill: true,
        availability: 'AVAILABLE', catalogueServiceId: null,
    };
    let orderFilter;
    let dispatchSession;
    let refillReads = 0;
    const session = {
        async withTransaction(callback) { await callback(); },
        async endSession() {},
    };
    const result = await createRefillRequest({
        userId: 'user-1', publicOrderId: 'ord_public', clientIdempotencyKey: 'request-1',
    }, {
        config: { defaultGuaranteeDays: 30, cooldownHours: 24, statusPollMinutes: 5 },
        mongoose: { async startSession() { return session; } },
        Order: {
            findOne(filter) { orderFilter = filter; return query(order); },
            async findById() { return order; },
        },
        ProviderOffer: { findOne: () => query(offer) },
        CatalogueService: { findById: () => query(null) },
        Provider: { findById: () => query({ _id: 'provider-1', enabled: true, healthStatus: 'HEALTHY' }) },
        RefillRequest: {
            findOne(filter) {
                if (filter.userId && filter.idempotencyKey) return query(null);
                refillReads += 1;
                return query(null);
            },
            async create(documents, options) {
                assert.equal(options.session, session);
                return [{ ...documents[0], _id: 'refill-1' }];
            },
        },
        async createDispatch(document, receivedSession) {
            assert.equal(document.jobKey, 'refill-refill-1');
            dispatchSession = receivedSession;
        },
        async dispatchByJobKey() { return { dispatchStatus: 'ENQUEUED' }; },
    });
    assert.deepEqual(orderFilter, { orderId: 'ord_public', user: 'user-1' });
    assert.equal(dispatchSession, session);
    assert.equal(result.refill.status, 'REQUESTED');
    assert.equal(result.queueDispatchPending, false);
    assert.equal(refillReads, 2);
});

function submissionHarness({ response, throws = false }) {
    const refill = {
        _id: 'refill-1', orderId: 'order-1', providerId: 'provider-1',
        providerOrderId: 'provider-order-1', status: 'REQUESTED',
        expiresAt: new Date(Date.now() + 86400000), activeOrderKey: 'order-1',
    };
    let calls = 0;
    const applyUpdate = (update) => {
        Object.assign(refill, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete refill[key];
        return refill;
    };
    return {
        refill,
        calls: () => calls,
        dependencies: {
            config: { defaultGuaranteeDays: 30, cooldownHours: 24, statusPollMinutes: 5 },
            RefillRequest: {
                async findById() { return refill; },
                async findOneAndUpdate(filter, update) { void filter; return applyUpdate(update); },
            },
            Provider: { async findById() { return { _id: 'provider-1', enabled: true, healthStatus: 'HEALTHY', adapterType: 'LEGACY_SMM' }; } },
            Order: { async updateOne() {} },
            getProviderAdapter() {
                return { async requestRefill() { calls += 1; if (throws) throw new Error('timeout'); return response; } };
            },
        },
    };
}

test('provider refill submission is claimed once and accepted responses are persisted', async () => {
    const harness = submissionHarness({ response: { refill: 12345 } });
    const first = await submitRefillRequest('refill-1', harness.dependencies);
    const replay = await submitRefillRequest('refill-1', harness.dependencies);
    assert.equal(first.refill.status, 'SENT_TO_PROVIDER');
    assert.equal(first.refill.providerRefillId, '12345');
    assert.equal(replay.alreadyClaimed, true);
    assert.equal(harness.calls(), 1);
});

test('ambiguous provider refill timeout is never retried and remains support-blocked', async () => {
    const harness = submissionHarness({ throws: true });
    const first = await submitRefillRequest('refill-1', harness.dependencies);
    const replay = await submitRefillRequest('refill-1', harness.dependencies);
    assert.equal(first.refill.status, 'NEEDS_SUPPORT');
    assert.equal(first.ambiguous, true);
    assert.equal(replay.alreadyClaimed, true);
    assert.equal(harness.refill.activeOrderKey, 'order-1');
    assert.equal(harness.calls(), 1);
});

test('provider refill statuses map to the durable local state machine', () => {
    assert.equal(mapProviderRefillStatus('Completed'), 'COMPLETED');
    assert.equal(mapProviderRefillStatus('Cancelled'), 'REJECTED');
    assert.equal(mapProviderRefillStatus('Failed'), 'FAILED');
    assert.equal(mapProviderRefillStatus('In progress'), 'IN_PROGRESS');
});
