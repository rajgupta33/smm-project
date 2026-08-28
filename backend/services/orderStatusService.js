const Order = require('../models/Order');
const Provider = require('../models/Provider');
const { getRuntimeConfig } = require('../config/runtimeConfig');
const {
    getCurrentProviderAdapter,
    getProviderAdapterForProvider,
} = require('../providers/providerRegistry');
const { appendOrderEvent } = require('./orderEventService');

const TERMINAL_STATUSES = new Set([
    'completed', 'partial', 'canceled', 'cancelled', 'rejected', 'failed', 'error',
]);

function dependencies(overrides = {}) {
    return {
        Order: overrides.Order || Order,
        Provider: overrides.Provider || Provider,
        getCurrentProviderAdapter: overrides.getCurrentProviderAdapter || getCurrentProviderAdapter,
        getProviderAdapterForProvider: overrides.getProviderAdapterForProvider || getProviderAdapterForProvider,
        appendOrderEvent: overrides.appendOrderEvent || appendOrderEvent,
        config: overrides.config || getRuntimeConfig().orderStatus,
        now: overrides.now ? overrides.now() : new Date(),
    };
}

function normalizedStatus(value) {
    return String(value || '').trim().toLowerCase().replaceAll('_', ' ');
}

function isTerminalOrderStatus(value) {
    return TERMINAL_STATUSES.has(normalizedStatus(value));
}

class OrderStatusError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'OrderStatusError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

/**
 * Refreshes one order's status from its fulfilling provider. Safe to call
 * concurrently: the persisted update is guarded on lifecycleStatus so a
 * background poll and a customer-triggered refresh cannot race each other
 * into an inconsistent write.
 */
async function pollOrderStatus(orderId, overrides = {}) {
    const deps = dependencies(overrides);
    const order = await deps.Order.findById(orderId);
    if (!order) throw new OrderStatusError('Order not found', 'ORDER_NOT_FOUND', 404);
    if (order.lifecycleStatus !== 'SUBMITTED' || !order.providerOrderId) {
        return { order, terminal: true, polled: false };
    }

    let adapter = deps.getCurrentProviderAdapter();
    if (order.providerId) {
        const provider = await deps.Provider.findById(order.providerId).select('+credentialReference');
        if (!provider) throw new OrderStatusError('Provider not found', 'ORDER_STATUS_PROVIDER_MISSING', 409);
        adapter = deps.getProviderAdapterForProvider(provider);
    }

    const response = await adapter.getOrderStatus(order.providerOrderId);
    const rawStatus = response?.status || order.lastStatus;
    const terminal = isTerminalOrderStatus(rawStatus);
    const completed = normalizedStatus(rawStatus) === 'completed';
    const now = deps.now;

    const update = {
        lastStatus: rawStatus,
        lastOrderStatusCheckAt: now,
        nextOrderStatusCheckAt: terminal
            ? null
            : new Date(now.getTime() + deps.config.pollMinutes * 60000),
    };
    if (response && typeof response.start_count !== 'undefined') {
        update.start_count = response.start_count;
    }
    if (completed) update.lifecycleStatus = 'COMPLETED';

    const updated = await deps.Order.findOneAndUpdate(
        { _id: order._id, lifecycleStatus: 'SUBMITTED' },
        { $set: update },
        { new: true }
    );
    if (!updated) return { order, terminal: true, polled: false };

    if (normalizedStatus(rawStatus) !== normalizedStatus(order.lastStatus)) {
        await deps.appendOrderEvent({
            orderId: order._id,
            userId: order.user,
            eventType: 'STATUS_CHANGED',
            metadata: { oldStatus: order.lastStatus, newStatus: rawStatus },
        }).catch((error) => console.error('Failed to append STATUS_CHANGED event', error.message));
    }

    return { order: updated, terminal, polled: true };
}

/**
 * Finds every submitted order due for a status refresh and polls each one.
 * A per-order failure schedules a retry rather than blocking the batch or
 * looping tightly on one bad order.
 */
async function scanOrderStatuses(overrides = {}) {
    const deps = dependencies(overrides);
    const now = deps.now;
    const due = await deps.Order.find({
        lifecycleStatus: 'SUBMITTED',
        providerOrderId: { $exists: true, $ne: null },
        $or: [
            { nextOrderStatusCheckAt: null },
            { nextOrderStatusCheckAt: { $lte: now } },
        ],
    }).sort({ nextOrderStatusCheckAt: 1 }).limit(100).select('_id');

    const counts = { scanned: due.length, updated: 0, terminal: 0, failed: 0 };
    for (const order of due) {
        try {
            const result = await pollOrderStatus(order._id, overrides);
            if (result.polled) counts.updated += 1;
            if (result.terminal) counts.terminal += 1;
        } catch (error) {
            counts.failed += 1;
            await deps.Order.updateOne(
                { _id: order._id, lifecycleStatus: 'SUBMITTED' },
                { $set: { nextOrderStatusCheckAt: new Date(now.getTime() + deps.config.pollMinutes * 60000) } }
            ).catch(() => {});
            console.error(`Order status poll failed for ${order._id}:`, error.message);
        }
    }
    return counts;
}

module.exports = {
    OrderStatusError,
    isTerminalOrderStatus,
    pollOrderStatus,
    scanOrderStatuses,
};
