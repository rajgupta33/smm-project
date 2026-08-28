const mongoose = require('mongoose');
const Order = require('../models/Order');
const Provider = require('../models/Provider');
const ProviderOffer = require('../models/ProviderOffer');
const CatalogueService = require('../models/CatalogueService');
const RefillRequest = require('../models/RefillRequest');
const { getRuntimeConfig } = require('../config/runtimeConfig');
const { getProviderAdapterForProvider } = require('../providers/providerRegistry');
const {
    createDispatch, dispatchByJobKey, refillDispatchDocument,
} = require('./jobDispatchService');
const { appendOrderEvent } = require('./orderEventService');

const PENDING_STATUSES = ['REQUESTED', 'VALIDATING', 'SENT_TO_PROVIDER', 'IN_PROGRESS', 'NEEDS_SUPPORT'];
const ELIGIBLE_ORDER_STATUSES = new Set(['completed', 'partial']);

class RefillError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'RefillError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizedStatus(value) {
    return String(value || '').trim().toLowerCase().replaceAll('_', ' ');
}

function safeProviderSnapshot(response) {
    if (!response || typeof response !== 'object') return null;
    return {
        refill: response.refill ? String(response.refill) : null,
        status: response.status ? String(response.status) : null,
        error: response.error ? String(response.error).slice(0, 300) : null,
    };
}

function guaranteeUntil(order, config) {
    if (order.refillGuaranteeUntil) return new Date(order.refillGuaranteeUntil);
    return new Date(new Date(order.createdAt).getTime() + config.defaultGuaranteeDays * 86400000);
}

async function evaluateEligibility({ order, now, session }, dependencies) {
    if (!order) throw new RefillError('Order not found', 'ORDER_NOT_FOUND', 404);
    if (order.lifecycleStatus && order.lifecycleStatus !== 'SUBMITTED') {
        throw new RefillError('Order has not been confirmed by the provider', 'ORDER_NOT_SUBMITTED', 409);
    }
    const providerOrderId = order.providerOrderId || (order.localOrderId ? null : order.orderId);
    if (!providerOrderId) {
        throw new RefillError('Order has no confirmed provider identifier', 'ORDER_NOT_SUBMITTED', 409);
    }
    if (!ELIGIBLE_ORDER_STATUSES.has(normalizedStatus(order.lastStatus))) {
        throw new RefillError('Order status is not eligible for refill', 'REFILL_STATUS_INELIGIBLE', 409);
    }

    const offerQuery = order.providerOfferId
        ? { _id: order.providerOfferId }
        : { providerServiceId: order.providerServiceId };
    const offer = await dependencies.ProviderOffer.findOne(offerQuery).session(session);
    const legacyRefillSnapshot = !offer && order.refill === '';
    if ((!offer && !legacyRefillSnapshot) ||
        (offer && (!offer.supportsRefill || offer.availability !== 'AVAILABLE'))) {
        throw new RefillError('Provider does not currently support refill for this service', 'REFILL_UNSUPPORTED', 409);
    }
    if (order.catalogueServiceId || offer?.catalogueServiceId) {
        const catalogue = await dependencies.CatalogueService.findById(
            order.catalogueServiceId || offer?.catalogueServiceId
        ).session(session);
        if (!catalogue || catalogue.refillPolicy !== 'PROVIDER_SUPPORTED') {
            throw new RefillError('Catalogue refill policy does not permit this request', 'REFILL_UNSUPPORTED', 409);
        }
    }

    const provider = order.providerId || offer?.providerId
        ? await dependencies.Provider.findById(order.providerId || offer.providerId).session(session)
        : await dependencies.Provider.findOne({ enabled: true }).sort({ priority: 1 }).session(session);
    if (!provider || !provider.enabled || provider.healthStatus === 'UNAVAILABLE') {
        throw new RefillError('Provider is not available for refill', 'REFILL_PROVIDER_UNAVAILABLE', 409);
    }
    const expiresAt = guaranteeUntil(order, dependencies.config);
    if (expiresAt <= now) throw new RefillError('Refill guarantee has expired', 'REFILL_GUARANTEE_EXPIRED', 409);

    const active = await dependencies.RefillRequest.findOne({
        orderId: order._id, status: { $in: PENDING_STATUSES },
    }).session(session);
    if (active) throw new RefillError('A refill request is already active', 'REFILL_ALREADY_ACTIVE', 409);
    const previous = await dependencies.RefillRequest.findOne({ orderId: order._id })
        .sort({ requestedAt: -1 }).session(session);
    if (!previous && typeof order.refill === 'string' && order.refill.trim()) {
        throw new RefillError('This legacy order already has a refill request', 'REFILL_ALREADY_ACTIVE', 409);
    }
    if (previous?.cooldownUntil && previous.cooldownUntil > now) {
        throw new RefillError('Refill cooldown is still active', 'REFILL_COOLDOWN_ACTIVE', 409);
    }

    return {
        provider, offer, providerOrderId: String(providerOrderId), expiresAt,
        snapshot: {
            evaluatedAt: now,
            orderStatus: order.lastStatus,
            lifecycleStatus: order.lifecycleStatus || 'LEGACY_SUBMITTED',
            guaranteeUntil: expiresAt,
            providerId: String(provider._id),
            providerOfferId: offer?._id ? String(offer._id) : null,
            supportsRefill: true,
            providerAvailability: offer?.availability || 'LEGACY_ORDER_SNAPSHOT',
            providerEligibilityCheck: 'DEFERRED_TO_SUBMISSION',
        },
    };
}

function dependencies(overrides = {}) {
    return {
        mongoose: overrides.mongoose || mongoose,
        Order: overrides.Order || Order,
        Provider: overrides.Provider || Provider,
        ProviderOffer: overrides.ProviderOffer || ProviderOffer,
        CatalogueService: overrides.CatalogueService || CatalogueService,
        RefillRequest: overrides.RefillRequest || RefillRequest,
        createDispatch: overrides.createDispatch || createDispatch,
        dispatchByJobKey: overrides.dispatchByJobKey || dispatchByJobKey,
        getProviderAdapterForProvider: overrides.getProviderAdapterForProvider
            || (overrides.getProviderAdapter
                ? (provider) => overrides.getProviderAdapter(provider.adapterType)
                : getProviderAdapterForProvider),
        config: overrides.config || getRuntimeConfig().refill,
    };
}

async function createRefillRequest({ userId, publicOrderId, clientIdempotencyKey }, overrides = {}) {
    const deps = dependencies(overrides);
    if (typeof clientIdempotencyKey !== 'string' || !clientIdempotencyKey.trim() || clientIdempotencyKey.length > 200) {
        throw new RefillError('A valid Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED');
    }
    if (typeof publicOrderId !== 'string' || !publicOrderId.trim()) {
        throw new RefillError('Order ID is required', 'INVALID_ORDER_ID');
    }
    publicOrderId = publicOrderId.trim();
    const idempotencyKey = clientIdempotencyKey.trim();
    const existing = await deps.RefillRequest.findOne({ userId, idempotencyKey });
    if (existing) {
        const existingOrder = await deps.Order.findById(existing.orderId);
        if (!existingOrder || existingOrder.orderId !== publicOrderId) {
            throw new RefillError('Idempotency key is already used for another refill', 'IDEMPOTENCY_CONFLICT', 409);
        }
        await deps.dispatchByJobKey(refillDispatchDocument(existing._id).jobKey).catch(() => {});
        return { refill: existing, idempotentReplay: true };
    }

    const session = await deps.mongoose.startSession();
    let refill;
    try {
        await session.withTransaction(async () => {
            const order = await deps.Order.findOne({ orderId: publicOrderId, user: userId }).session(session);
            const now = new Date();
            const eligible = await evaluateEligibility({ order, now, session }, deps);
            [refill] = await deps.RefillRequest.create([{
                orderId: order._id,
                userId,
                providerId: eligible.provider._id,
                providerOrderId: eligible.providerOrderId,
                status: 'REQUESTED',
                requestedAt: now,
                eligibilitySnapshot: eligible.snapshot,
                cooldownUntil: new Date(now.getTime() + deps.config.cooldownHours * 3600000),
                expiresAt: eligible.expiresAt,
                activeOrderKey: String(order._id),
                idempotencyKey,
            }], { session });
            await deps.createDispatch(refillDispatchDocument(refill._id), session);
            await appendOrderEvent({
                orderId: order._id,
                userId,
                eventType: 'REFILL_REQUESTED',
                metadata: { refillId: refill._id },
                session
            }).catch(err => console.error('Failed to append REFILL_REQUESTED event', err));
        });
    } catch (error) {
        if (error?.code !== 11000) throw error;
        const replay = await deps.RefillRequest.findOne({ userId, idempotencyKey });
        if (replay) return { refill: replay, idempotentReplay: true };
        throw new RefillError('A refill request is already active', 'REFILL_ALREADY_ACTIVE', 409);
    } finally {
        await session.endSession();
    }
    const dispatch = await deps.dispatchByJobKey(refillDispatchDocument(refill._id).jobKey)
        .catch(() => ({ dispatchStatus: 'PENDING' }));
    return { refill, idempotentReplay: false, queueDispatchPending: dispatch.dispatchStatus !== 'ENQUEUED' };
}

async function submitRefillRequest(refillRequestId, overrides = {}) {
    const deps = dependencies(overrides);
    const refill = await deps.RefillRequest.findById(refillRequestId);
    if (!refill) throw new RefillError('Refill request not found', 'REFILL_NOT_FOUND', 404);
    if (refill.status !== 'REQUESTED') return { refill, alreadyClaimed: true };
    if (refill.expiresAt <= new Date()) {
        const expired = await deps.RefillRequest.findOneAndUpdate(
            { _id: refill._id, status: 'REQUESTED' },
            { $set: { status: 'EXPIRED', failureReason: 'Guarantee expired before dispatch' }, $unset: { activeOrderKey: 1 } },
            { new: true }
        );
        return { refill: expired, terminal: true };
    }
    const claimed = await deps.RefillRequest.findOneAndUpdate(
        { _id: refill._id, status: 'REQUESTED' },
        { $set: { status: 'VALIDATING', failureReason: null } },
        { new: true }
    );
    if (!claimed) return { refill, alreadyClaimed: true };

    let providerQuery = deps.Provider.findById(claimed.providerId);
    if (typeof providerQuery?.select === 'function') {
        providerQuery = providerQuery.select('+credentialReference');
    }
    const provider = await providerQuery;
    if (!provider || !provider.enabled || provider.healthStatus === 'UNAVAILABLE') {
        const rejected = await deps.RefillRequest.findOneAndUpdate(
            { _id: claimed._id, status: 'VALIDATING' },
            { $set: { status: 'REJECTED', failureReason: 'Provider is unavailable' }, $unset: { activeOrderKey: 1 } },
            { new: true }
        );
        return { refill: rejected, terminal: true };
    }

    let response;
    try {
        response = await deps.getProviderAdapterForProvider(provider).requestRefill(claimed.providerOrderId);
    } catch {
        const uncertain = await deps.RefillRequest.findOneAndUpdate(
            { _id: claimed._id, status: 'VALIDATING' },
            { $set: { status: 'NEEDS_SUPPORT', failureReason: 'Provider request outcome is unknown' } },
            { new: true }
        );
        return { refill: uncertain, ambiguous: true };
    }
    if (response?.error) {
        const rejected = await deps.RefillRequest.findOneAndUpdate(
            { _id: claimed._id, status: 'VALIDATING' },
            {
                $set: {
                    status: 'REJECTED', failureReason: String(response.error).slice(0, 300),
                    providerStatusSnapshot: safeProviderSnapshot(response),
                },
                $unset: { activeOrderKey: 1 },
            },
            { new: true }
        );
        return { refill: rejected, terminal: true };
    }
    if (!response?.refill) {
        const uncertain = await deps.RefillRequest.findOneAndUpdate(
            { _id: claimed._id, status: 'VALIDATING' },
            {
                $set: {
                    status: 'NEEDS_SUPPORT', failureReason: 'Provider response had no refill identifier',
                    providerStatusSnapshot: safeProviderSnapshot(response),
                },
            },
            { new: true }
        );
        return { refill: uncertain, ambiguous: true };
    }
    const nextCheck = new Date(Date.now() + deps.config.statusPollMinutes * 60000);
    const accepted = await deps.RefillRequest.findOneAndUpdate(
        { _id: claimed._id, status: 'VALIDATING' },
        {
            $set: {
                status: 'SENT_TO_PROVIDER', providerRefillId: String(response.refill),
                nextStatusCheckAt: nextCheck, providerStatusSnapshot: safeProviderSnapshot(response),
            },
        },
        { new: true, runValidators: true }
    );
    await deps.Order.updateOne({ _id: claimed.orderId }, { $set: { refill: String(response.refill) } });
    return { refill: accepted };
}

function mapProviderRefillStatus(value) {
    const status = normalizedStatus(value);
    if (status === 'completed') return 'COMPLETED';
    if (['rejected', 'canceled', 'cancelled'].includes(status)) return 'REJECTED';
    if (['failed', 'error'].includes(status)) return 'FAILED';
    return 'IN_PROGRESS';
}

async function pollRefillStatus(refillRequestId, overrides = {}) {
    const deps = dependencies(overrides);
    const refill = await deps.RefillRequest.findById(refillRequestId);
    if (!refill) throw new RefillError('Refill request not found', 'REFILL_NOT_FOUND', 404);
    if (!['SENT_TO_PROVIDER', 'IN_PROGRESS'].includes(refill.status)) return { refill, terminal: true };
    if (refill.expiresAt <= new Date()) {
        const expired = await deps.RefillRequest.findOneAndUpdate(
            { _id: refill._id, status: { $in: ['SENT_TO_PROVIDER', 'IN_PROGRESS'] } },
            { $set: { status: 'EXPIRED', failureReason: 'Refill guarantee expired' }, $unset: { activeOrderKey: 1 } },
            { new: true }
        );
        return { refill: expired, terminal: true };
    }
    let providerQuery = deps.Provider.findById(refill.providerId);
    if (typeof providerQuery?.select === 'function') {
        providerQuery = providerQuery.select('+credentialReference');
    }
    const provider = await providerQuery;
    if (!provider) throw new RefillError('Provider not found', 'REFILL_PROVIDER_MISSING', 409);
    const response = await deps.getProviderAdapterForProvider(provider).getRefillStatus(refill.providerRefillId);
    const status = mapProviderRefillStatus(response?.status);
    const terminal = ['COMPLETED', 'REJECTED', 'FAILED'].includes(status);
    const now = new Date();
    const updated = await deps.RefillRequest.findOneAndUpdate(
        { _id: refill._id, status: { $in: ['SENT_TO_PROVIDER', 'IN_PROGRESS'] } },
        {
            $set: {
                status, lastStatusCheckAt: now,
                nextStatusCheckAt: terminal ? null : new Date(now.getTime() + deps.config.statusPollMinutes * 60000),
                failureReason: terminal && status !== 'COMPLETED' ? String(response?.error || status) : null,
                providerStatusSnapshot: safeProviderSnapshot(response),
            },
            ...(terminal ? { $unset: { activeOrderKey: 1 } } : {}),
        },
        { new: true }
    );
    return { refill: updated, terminal };
}

async function scanRefillRequests(overrides = {}) {
    const deps = dependencies(overrides);
    const now = new Date();
    const [requested, due, interrupted] = await Promise.all([
        deps.RefillRequest.find({ status: 'REQUESTED' }).sort({ requestedAt: 1 }).limit(50).select('_id'),
        deps.RefillRequest.find({
            status: { $in: ['SENT_TO_PROVIDER', 'IN_PROGRESS'] }, nextStatusCheckAt: { $lte: now },
        }).sort({ nextStatusCheckAt: 1 }).limit(100).select('_id'),
        deps.RefillRequest.updateMany(
            { status: 'VALIDATING', updatedAt: { $lte: new Date(now.getTime() - 5 * 60000) } },
            { $set: { status: 'NEEDS_SUPPORT', failureReason: 'Worker interrupted during provider submission' } }
        ),
    ]);
    const counts = { requested: requested.length, polled: due.length, failed: 0, needsSupport: interrupted.modifiedCount || 0 };
    for (const refill of requested) {
        try { await submitRefillRequest(refill._id, overrides); } catch { counts.failed += 1; }
    }
    for (const refill of due) {
        try { await pollRefillStatus(refill._id, overrides); } catch {
            counts.failed += 1;
            await deps.RefillRequest.updateOne(
                { _id: refill._id, status: { $in: ['SENT_TO_PROVIDER', 'IN_PROGRESS'] } },
                { $set: { nextStatusCheckAt: new Date(now.getTime() + deps.config.statusPollMinutes * 60000) } }
            );
        }
    }
    return counts;
}

module.exports = {
    ELIGIBLE_ORDER_STATUSES,
    PENDING_STATUSES,
    RefillError,
    createRefillRequest,
    evaluateEligibility,
    mapProviderRefillStatus,
    pollRefillStatus,
    safeProviderSnapshot,
    scanRefillRequests,
    submitRefillRequest,
};
