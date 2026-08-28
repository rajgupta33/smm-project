const assert = require('node:assert/strict');
const { test } = require('node:test');
const JobDispatch = require('../models/JobDispatch');
const {
    createDispatch,
    dispatchClaimed,
    dripFeedDispatchDocument,
    jobOptions,
    orderDispatchDocument,
    providerSyncDispatchDocument,
    refillDispatchDocument,
} = require('../services/jobDispatchService');

test('durable dispatch records use stable non-numeric BullMQ job IDs', () => {
    const order = orderDispatchDocument('507f1f77bcf86cd799439011');
    const sync = providerSyncDispatchDocument('507f191e810c19729de860ea');
    const refill = refillDispatchDocument('507f191e810c19729de860eb');
    const drip = dripFeedDispatchDocument(
        '507f191e810c19729de860ec',
        '507f191e810c19729de860ed',
        2,
        new Date(Date.now() + 60000)
    );
    assert.equal(order.jobKey, 'order-507f1f77bcf86cd799439011');
    assert.equal(sync.jobKey, 'sync-507f191e810c19729de860ea');
    assert.equal(refill.jobKey, 'refill-507f191e810c19729de860eb');
    assert.equal(drip.jobKey, 'drip:507f191e810c19729de860ed:2');
    assert.deepEqual(drip.payload, { runId: '507f191e810c19729de860ec' });
    assert.equal(jobOptions(order).attempts, 1);
    assert.equal(jobOptions(sync).attempts, 3);
    assert.equal(jobOptions(sync).backoff.type, 'exponential');
    assert.equal(jobOptions(refill).attempts, 1);
    assert.equal(jobOptions(drip).attempts, 1);
    assert.ok(jobOptions(drip).delay > 0);
});

test('dispatch creation participates in the caller MongoDB session', async () => {
    const session = { id: 'transaction-session' };
    let receivedOptions;
    const model = {
        async create(documents, options) {
            receivedOptions = options;
            return [{ ...documents[0], _id: 'dispatch-id' }];
        },
    };
    const result = await createDispatch(orderDispatchDocument('order-db-id'), session, model);
    assert.equal(result._id, 'dispatch-id');
    assert.equal(receivedOptions.session, session);
});

test('successful Redis enqueue marks the outbox record enqueued', async () => {
    const updates = [];
    const dispatch = {
        _id: 'dispatch-id', jobKey: 'order-id', queueName: 'provider-order-submit',
        jobName: 'submit-order', payload: { orderId: 'id' }, dispatchAttempts: 1,
    };
    const result = await dispatchClaimed(dispatch, {
        getQueue: () => ({
            async add(name, payload, options) {
                assert.equal(name, 'submit-order');
                assert.deepEqual(payload, { orderId: 'id' });
                assert.equal(options.jobId, 'order-id');
            },
        }),
        JobDispatch: { async updateOne(filter, update) { updates.push({ filter, update }); } },
    });
    assert.equal(result.dispatched, true);
    assert.equal(updates[0].update.$set.status, 'ENQUEUED');
});

test('failed Redis enqueue returns the record to pending for retry', async () => {
    const updates = [];
    const result = await dispatchClaimed({
        _id: 'dispatch-id', jobKey: 'sync-id', queueName: 'provider-sync',
        jobName: 'sync-provider-report', payload: { runId: 'id' }, dispatchAttempts: 1,
    }, {
        getQueue: () => ({ async add() { throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }); } }),
        JobDispatch: { async updateOne(filter, update) { updates.push({ filter, update }); } },
    });
    assert.equal(result.dispatched, false);
    assert.equal(updates[0].update.$set.status, 'PENDING');
    assert.equal(updates[0].update.$set.lastErrorCode, 'ECONNREFUSED');
});

test('JobDispatch has database uniqueness and pending-work indexes', () => {
    const indexes = JobDispatch.schema.indexes();
    assert.ok(indexes.some(([keys, options]) => keys.jobKey === 1 && options.unique));
    assert.ok(indexes.some(([keys]) => keys.status === 1 && keys.nextAttemptAt === 1));
});
