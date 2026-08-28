const assert = require('node:assert/strict');
const test = require('node:test');

const { isTerminalOrderStatus, pollOrderStatus, scanOrderStatuses } = require('../services/orderStatusService');

function listQuery(value) {
    return {
        sort() { return this; },
        limit() { return this; },
        select() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function baseOrder(overrides = {}) {
    return {
        _id: 'order-1',
        user: 'user-1',
        lifecycleStatus: 'SUBMITTED',
        providerOrderId: 'provider-order-1',
        providerId: null,
        lastStatus: 'Pending',
        ...overrides,
    };
}

function dependenciesFor({ order, providerResponse, findOneAndUpdateResult, now } = {}) {
    let updateArgs = null;
    return {
        deps: {
            now: () => now || new Date('2026-08-29T12:00:00Z'),
            config: { pollMinutes: 10 },
            Order: {
                findById: async () => order,
                findOneAndUpdate: async (query, update) => {
                    updateArgs = { query, update };
                    return findOneAndUpdateResult === undefined ? { ...order, ...update.$set } : findOneAndUpdateResult;
                },
                updateOne: async () => ({ modifiedCount: 1 }),
            },
            Provider: { findById: () => listQuery(null) },
            getCurrentProviderAdapter: () => ({
                getOrderStatus: async () => providerResponse,
            }),
            getProviderAdapterForProvider: () => ({
                getOrderStatus: async () => providerResponse,
            }),
            appendOrderEvent: async () => {},
        },
        getUpdateArgs: () => updateArgs,
    };
}

test('isTerminalOrderStatus recognizes standard SMM provider terminal statuses', () => {
    assert.equal(isTerminalOrderStatus('Completed'), true);
    assert.equal(isTerminalOrderStatus('Partial'), true);
    assert.equal(isTerminalOrderStatus('Canceled'), true);
    assert.equal(isTerminalOrderStatus('In progress'), false);
    assert.equal(isTerminalOrderStatus('Pending'), false);
});

test('pollOrderStatus is a no-op for orders that are not submitted or have no provider order id', async () => {
    const { deps: notSubmitted } = dependenciesFor({ order: baseOrder({ lifecycleStatus: 'MANUAL_PROCESSING' }) });
    const result = await pollOrderStatus('order-1', notSubmitted);
    assert.equal(result.polled, false);
    assert.equal(result.terminal, true);

    const { deps: noProviderOrderId } = dependenciesFor({ order: baseOrder({ providerOrderId: null }) });
    const result2 = await pollOrderStatus('order-1', noProviderOrderId);
    assert.equal(result2.polled, false);
});

test('pollOrderStatus refreshes status and schedules the next check for a non-terminal status', async () => {
    const now = new Date('2026-08-29T12:00:00Z');
    const { deps, getUpdateArgs } = dependenciesFor({
        order: baseOrder(),
        providerResponse: { status: 'In progress', start_count: '120' },
        now,
    });
    const result = await pollOrderStatus('order-1', deps);
    assert.equal(result.polled, true);
    assert.equal(result.terminal, false);
    const { update } = getUpdateArgs();
    assert.equal(update.$set.lastStatus, 'In progress');
    assert.equal(update.$set.start_count, '120');
    assert.equal(update.$set.nextOrderStatusCheckAt.getTime(), now.getTime() + 10 * 60000);
    assert.equal(update.$set.lifecycleStatus, undefined);
});

test('pollOrderStatus marks the order completed and stops scheduling further checks on completion', async () => {
    const { deps, getUpdateArgs } = dependenciesFor({
        order: baseOrder(),
        providerResponse: { status: 'Completed', start_count: '500' },
    });
    const result = await pollOrderStatus('order-1', deps);
    assert.equal(result.terminal, true);
    const { update, query } = getUpdateArgs();
    assert.equal(update.$set.lifecycleStatus, 'COMPLETED');
    assert.equal(update.$set.nextOrderStatusCheckAt, null);
    assert.equal(query.lifecycleStatus, 'SUBMITTED');
});

test('pollOrderStatus stops scheduling on a terminal non-completed status without changing lifecycle', async () => {
    const { deps, getUpdateArgs } = dependenciesFor({
        order: baseOrder(),
        providerResponse: { status: 'Partial' },
    });
    await pollOrderStatus('order-1', deps);
    const { update } = getUpdateArgs();
    assert.equal(update.$set.nextOrderStatusCheckAt, null);
    assert.equal(update.$set.lifecycleStatus, undefined);
});

test('scanOrderStatuses polls every due order and schedules a retry after a failed poll', async () => {
    const now = new Date('2026-08-29T12:00:00Z');
    const dueOrders = [{ _id: 'order-1' }, { _id: 'order-2' }];
    const scheduledRetries = [];
    let pollCount = 0;
    const overrides = {
        now: () => now,
        config: { pollMinutes: 10 },
        Order: {
            find: () => listQuery(dueOrders),
            findById: async (id) => {
                pollCount += 1;
                if (id === 'order-2') throw new Error('provider unreachable');
                return baseOrder({ _id: id });
            },
            findOneAndUpdate: async (query, update) => ({ ...baseOrder(), ...update.$set }),
            updateOne: async (query, update) => {
                scheduledRetries.push({ query, update });
                return { modifiedCount: 1 };
            },
        },
        Provider: { findById: () => listQuery(null) },
        getCurrentProviderAdapter: () => ({ getOrderStatus: async () => ({ status: 'In progress' }) }),
        appendOrderEvent: async () => {},
    };

    const counts = await scanOrderStatuses(overrides);
    assert.equal(counts.scanned, 2);
    assert.equal(pollCount, 2);
    assert.equal(counts.failed, 1);
    assert.equal(scheduledRetries.length, 1);
    assert.equal(scheduledRetries[0].query._id, 'order-2');
    assert.equal(scheduledRetries[0].update.$set.nextOrderStatusCheckAt.getTime(), now.getTime() + 10 * 60000);
});
