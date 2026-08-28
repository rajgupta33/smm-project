const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    processOrderSubmissionJob,
    processProviderSyncJob,
    processRefillSubmissionJob,
} = require('../workers/jobProcessors');

test('order worker resolves the database order and invokes the guarded submission once', async () => {
    const order = { _id: 'order-id', lifecycleStatus: 'INTENT_COMMITTED' };
    let calls = 0;
    const result = await processOrderSubmissionJob({ orderId: 'order-id' }, {
        Order: { async findById(id) { assert.equal(id, 'order-id'); return order; } },
        async submitCommittedOrder(value) {
            calls += 1;
            assert.equal(value, order);
            return { lifecycleStatus: 'SUBMITTED' };
        },
    });
    assert.equal(result.lifecycleStatus, 'SUBMITTED');
    assert.equal(calls, 1);
});

test('refill worker resolves a durable request and invokes guarded submission once', async () => {
    let calls = 0;
    const result = await processRefillSubmissionJob({ refillRequestId: 'refill-id' }, {
        async submitRefillRequest(id) { calls += 1; assert.equal(id, 'refill-id'); return { status: 'SENT_TO_PROVIDER' }; },
    });
    assert.equal(result.status, 'SENT_TO_PROVIDER');
    assert.equal(calls, 1);
});

test('completed provider sync jobs are idempotent and do not call the provider again', async () => {
    let providerReads = 0;
    const result = await processProviderSyncJob({ runId: 'run-id' }, {
        ProviderSyncRun: { async findById() { return { _id: 'run-id', status: 'COMPLETED' }; } },
        Provider: { async findById() { providerReads += 1; } },
        async createProviderSyncReport() { throw new Error('must not execute'); },
    });
    assert.equal(result.alreadyFinished, true);
    assert.equal(providerReads, 0);
});

test('provider sync worker persists report and provider health metadata', async () => {
    const runUpdates = [];
    const providerUpdates = [];
    const run = { _id: 'run-id', providerId: 'provider-id', status: 'QUEUED', startedAt: null };
    const provider = { _id: 'provider-id', enabled: true };
    const report = { counts: { fetched: 1, existing: 0, new: 1, changed: 0, missing: 0, invalid: 0 } };
    const result = await processProviderSyncJob({ runId: 'run-id' }, {
        ProviderSyncRun: {
            async findById() { return run; },
            async updateOne(filter, update) { runUpdates.push({ filter, update }); },
        },
        Provider: {
            async findById() { return provider; },
            async updateOne(filter, update) { providerUpdates.push({ filter, update }); },
        },
        async createProviderSyncReport(value) { assert.equal(value, provider); return report; },
    });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(runUpdates.at(-1).update.$set.status, 'COMPLETED');
    assert.equal(providerUpdates[0].update.$set.healthStatus, 'HEALTHY');
});

test('provider sync leaves transient failures queued until the final attempt', async () => {
    const runUpdates = [];
    const error = new Error('provider temporarily unavailable');
    await assert.rejects(processProviderSyncJob({
        runId: 'run-id', attemptNumber: 1, maxAttempts: 3,
    }, {
        ProviderSyncRun: {
            async findById() { return { _id: 'run-id', providerId: 'provider-id', status: 'QUEUED' }; },
            async updateOne(filter, update) { runUpdates.push({ filter, update }); },
        },
        Provider: {
            async findById() { return { _id: 'provider-id', enabled: true }; },
            async updateOne() {},
        },
        async createProviderSyncReport() { throw error; },
    }), /temporarily unavailable/);
    assert.equal(runUpdates.at(-1).update.$set.status, 'QUEUED');
    assert.equal(runUpdates.at(-1).update.$set.completedAt, null);
});

test('provider sync marks configuration failures terminal without retries', async () => {
    const runUpdates = [];
    const error = Object.assign(new Error('provider disabled'), { statusCode: 409 });
    await assert.rejects(processProviderSyncJob({
        runId: 'run-id', attemptNumber: 1, maxAttempts: 3,
    }, {
        ProviderSyncRun: {
            async findById() { return { _id: 'run-id', providerId: 'provider-id', status: 'QUEUED' }; },
            async updateOne(filter, update) { runUpdates.push({ filter, update }); },
        },
        Provider: {
            async findById() { return { _id: 'provider-id', enabled: false }; },
            async updateOne() {},
        },
        async createProviderSyncReport() { throw error; },
    }), /provider disabled/);
    assert.equal(error.retryable, false);
    assert.equal(runUpdates.at(-1).update.$set.status, 'FAILED');
});
