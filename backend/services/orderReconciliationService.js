const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const DripFeedOrder = require('../models/DripFeedOrder');
const DripFeedRun = require('../models/DripFeedRun');
const Order = require('../models/Order');
const OrderReconciliation = require('../models/OrderReconciliation');
const { appendOrderEvent } = require('./orderEventService');
const { createDispatch, dripFeedDispatchDocument } = require('./jobDispatchService');
const { refundWallet } = require('./walletService');

class OrderReconciliationError extends Error {
    constructor(message, code = 'RECONCILIATION_FAILED', statusCode = 400) {
        super(message);
        this.name = 'OrderReconciliationError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function requiredText(value, field, min = 1, max = 2000) {
    if (typeof value !== 'string') {
        throw new OrderReconciliationError(`${field} is required`, 'INVALID_RECONCILIATION');
    }
    const normalized = value.trim();
    if (normalized.length < min || normalized.length > max) {
        throw new OrderReconciliationError(`${field} must be ${min}-${max} characters`, 'INVALID_RECONCILIATION');
    }
    return normalized;
}

function optionalHttpsUrl(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = requiredText(value, 'evidenceUrl', 1, 2048);
    try {
        if (new URL(normalized).protocol !== 'https:') throw new Error('not HTTPS');
    } catch {
        throw new OrderReconciliationError('evidenceUrl must be an HTTPS URL', 'INVALID_EVIDENCE_URL');
    }
    return normalized;
}

async function withSession(query, session) {
    return typeof query?.session === 'function' ? query.session(session) : query;
}

function nextDripRunDocument(parent, order, run, scheduledAt) {
    return {
        parentId: parent._id,
        runNumber: run.runNumber + 1,
        quantity: parent.quantityPerRun,
        scheduledAt,
        providerId: order.providerId || null,
        providerOfferId: order.providerOfferId || null,
        allocatedAmountMinor: Math.floor(parent.reservedAmountMinor / parent.totalRuns)
            + (run.runNumber + 1 <= parent.reservedAmountMinor % parent.totalRuns ? 1 : 0),
        pricingSnapshot: typeof order.pricingSnapshot?.toObject === 'function'
            ? order.pricingSnapshot.toObject() : { ...(order.pricingSnapshot || {}) },
        status: 'SCHEDULED',
        attemptCount: 0,
    };
}

async function loadDripContext(order, dependencies, session) {
    const parent = await withSession(dependencies.DripFeedOrder.findOne({ orderId: order._id }), session);
    if (!parent) return { workflowKind: 'STANDARD', parent: null, run: null };
    const runs = await withSession(dependencies.DripFeedRun.find({
        parentId: parent._id,
        status: 'RECONCILIATION_REQUIRED',
    }), session);
    if (parent.status !== 'RECONCILIATION_REQUIRED' || runs.length !== 1) {
        throw new OrderReconciliationError(
            'Drip-feed reconciliation state is incomplete and requires engineering review',
            'DRIP_RECONCILIATION_INCONSISTENT',
            409
        );
    }
    const [run] = runs;
    return { workflowKind: 'DRIP_FEED', parent, run };
}

async function resolveAccepted(order, context, input, dependencies, session, now) {
    if (context.workflowKind === 'STANDARD') {
        const updated = await dependencies.Order.findOneAndUpdate(
            { _id: order._id, lifecycleStatus: 'RECONCILIATION_REQUIRED', fundingStatus: 'DEBITED' },
            {
                $set: {
                    providerOrderId: input.providerOrderId,
                    lifecycleStatus: 'SUBMITTED',
                    lastStatus: 'Pending',
                    reconciliationReason: null,
                    reconciliationRequiredAt: null,
                    'submissionAttempt.finishedAt': now,
                    'submissionAttempt.outcome': 'ACCEPTED',
                    'submissionAttempt.failureKind': null,
                    'submissionAttempt.errorMessage': null,
                },
            },
            { new: true, runValidators: true, session }
        );
        if (!updated) throw new OrderReconciliationError('Order state changed before resolution', 'RECONCILIATION_CONFLICT', 409);
        return { order: updated, refundAmountMinor: 0, dripFeedRunId: null };
    }

    const { parent, run } = context;
    const acceptedRun = await dependencies.DripFeedRun.findOneAndUpdate(
        { _id: run._id, status: 'RECONCILIATION_REQUIRED', attemptCount: 1 },
        {
            $set: {
                status: 'SUBMITTED',
                providerOrderId: input.providerOrderId,
                'attempt.finishedAt': now,
                'attempt.outcome': 'ACCEPTED',
                'attempt.failureKind': null,
                'attempt.errorMessage': null,
            },
        },
        { new: true, runValidators: true, session }
    );
    if (!acceptedRun) throw new OrderReconciliationError('Drip-feed run state changed before resolution', 'RECONCILIATION_CONFLICT', 409);
    const finalRun = run.runNumber === parent.totalRuns;
    const nextRunAt = finalRun ? null : new Date(now.getTime() + parent.intervalMinutes * 60000);
    const updatedParent = await dependencies.DripFeedOrder.findOneAndUpdate(
        { _id: parent._id, status: 'RECONCILIATION_REQUIRED', completedRuns: run.runNumber - 1 },
        {
            $set: { status: finalRun ? 'COMPLETED' : 'ACTIVE', nextRunAt },
            $inc: { completedRuns: 1, acceptedAmountMinor: run.allocatedAmountMinor },
        },
        { new: true, runValidators: true, session }
    );
    if (!updatedParent) throw new OrderReconciliationError('Drip-feed parent state changed before resolution', 'RECONCILIATION_CONFLICT', 409);

    if (!finalRun) {
        const [nextRun] = await dependencies.DripFeedRun.create([
            nextDripRunDocument(parent, order, run, nextRunAt),
        ], { session });
        await dependencies.createDispatch(
            dripFeedDispatchDocument(nextRun._id, parent._id, nextRun.runNumber, nextRunAt),
            session
        );
    }
    const updatedOrder = await dependencies.Order.findOneAndUpdate(
        { _id: order._id, lifecycleStatus: 'RECONCILIATION_REQUIRED', fundingStatus: 'DEBITED' },
        {
            $set: {
                lifecycleStatus: finalRun ? 'COMPLETED' : 'DRIP_FEED',
                lastStatus: finalRun ? 'Completed' : `Drip-feed run ${run.runNumber} of ${parent.totalRuns} submitted`,
                reconciliationReason: null,
                reconciliationRequiredAt: null,
            },
        },
        { new: true, runValidators: true, session }
    );
    if (!updatedOrder) throw new OrderReconciliationError('Order state changed before resolution', 'RECONCILIATION_CONFLICT', 409);
    return { order: updatedOrder, refundAmountMinor: 0, dripFeedRunId: run._id };
}

async function resolveNotAccepted(order, context, input, dependencies, session, now) {
    const orderReference = order.localOrderId || order.orderId;
    const refundAmountMinor = context.workflowKind === 'DRIP_FEED'
        ? context.parent.reservedAmountMinor - context.parent.acceptedAmountMinor
        : order.pricingSnapshot?.sellingTotalMinor;
    if (!Number.isSafeInteger(refundAmountMinor) || refundAmountMinor <= 0) {
        throw new OrderReconciliationError('Authoritative refund amount is invalid', 'INVALID_REFUND_AMOUNT', 409);
    }
    await dependencies.refundWallet({
        userId: order.user,
        amountMinor: refundAmountMinor,
        type: 'REFUND',
        sourceType: 'ORDER',
        sourceId: orderReference,
        idempotencyKey: `reconciliation-refund:${orderReference}`,
        actorType: 'ADMIN',
        actorId: input.actorId,
        description: `Reconciliation refund for order ${orderReference}`,
        session,
    });

    if (context.workflowKind === 'DRIP_FEED') {
        const { parent, run } = context;
        const rejectedRun = await dependencies.DripFeedRun.findOneAndUpdate(
            { _id: run._id, status: 'RECONCILIATION_REQUIRED', attemptCount: 1 },
            {
                $set: {
                    status: 'REJECTED',
                    'attempt.finishedAt': now,
                    'attempt.outcome': 'DEFINITIVE_REJECTION',
                    'attempt.failureKind': 'RECONCILED_NOT_ACCEPTED',
                    'attempt.errorMessage': 'Admin verified that the provider did not accept this run',
                },
            },
            { new: true, runValidators: true, session }
        );
        if (!rejectedRun) throw new OrderReconciliationError('Drip-feed run state changed before resolution', 'RECONCILIATION_CONFLICT', 409);
        const cancelledParent = await dependencies.DripFeedOrder.findOneAndUpdate(
            { _id: parent._id, status: 'RECONCILIATION_REQUIRED' },
            { $set: { status: 'CANCELLED', nextRunAt: null, refundedAmountMinor: refundAmountMinor } },
            { new: true, runValidators: true, session }
        );
        if (!cancelledParent) throw new OrderReconciliationError('Drip-feed parent state changed before resolution', 'RECONCILIATION_CONFLICT', 409);
    }

    const fundingStatus = context.workflowKind === 'DRIP_FEED' && context.parent.acceptedAmountMinor > 0
        ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
    const lifecycleStatus = context.workflowKind === 'DRIP_FEED' ? 'CANCELLED' : 'PROVIDER_REJECTED';
    const set = {
        lifecycleStatus,
        fundingStatus,
        lastStatus: context.workflowKind === 'DRIP_FEED'
            ? 'Drip-feed cancelled and unexecuted value refunded' : 'Rejected and refunded',
        reconciliationReason: null,
        reconciliationRequiredAt: null,
    };
    if (context.workflowKind === 'STANDARD') {
        Object.assign(set, {
            'submissionAttempt.finishedAt': now,
            'submissionAttempt.outcome': 'DEFINITIVE_REJECTION',
            'submissionAttempt.failureKind': 'RECONCILED_NOT_ACCEPTED',
            'submissionAttempt.errorMessage': 'Admin verified that the provider did not accept this order',
        });
    }
    const updatedOrder = await dependencies.Order.findOneAndUpdate(
        { _id: order._id, lifecycleStatus: 'RECONCILIATION_REQUIRED', fundingStatus: 'DEBITED' },
        { $set: set },
        { new: true, runValidators: true, session }
    );
    if (!updatedOrder) throw new OrderReconciliationError('Order state changed before resolution', 'RECONCILIATION_CONFLICT', 409);
    return {
        order: updatedOrder,
        refundAmountMinor,
        dripFeedRunId: context.run?._id || null,
    };
}

async function resolveOrderReconciliation(input, overrides = {}) {
    const dependencies = {
        mongoose, AuditLog, DripFeedOrder, DripFeedRun, Order, OrderReconciliation,
        appendOrderEvent, createDispatch, refundWallet,
        ...overrides,
    };
    if (!dependencies.mongoose.isValidObjectId(input?.orderId)
        || !dependencies.mongoose.isValidObjectId(input?.actorId)) {
        throw new OrderReconciliationError('Order or administrator ID is invalid', 'INVALID_RECONCILIATION');
    }
    const resolution = input.resolution;
    if (!['CONFIRMED_ACCEPTED', 'CONFIRMED_NOT_ACCEPTED'].includes(resolution)) {
        throw new OrderReconciliationError('Resolution is invalid', 'INVALID_RECONCILIATION');
    }
    const normalized = {
        ...input,
        requestId: requiredText(input.requestId, 'requestId', 1, 200),
        evidenceNote: requiredText(input.evidenceNote, 'evidenceNote', 10, 2000),
        evidenceUrl: optionalHttpsUrl(input.evidenceUrl),
        providerOrderId: input.providerOrderId ? requiredText(input.providerOrderId, 'providerOrderId', 1, 200) : null,
    };
    if (resolution === 'CONFIRMED_ACCEPTED' && !normalized.providerOrderId) {
        throw new OrderReconciliationError('Provider order ID is required for accepted resolution', 'PROVIDER_ORDER_ID_REQUIRED');
    }
    if (resolution === 'CONFIRMED_NOT_ACCEPTED' && normalized.providerOrderId) {
        throw new OrderReconciliationError('Provider order ID is not allowed for non-acceptance', 'INVALID_RECONCILIATION');
    }

    const session = await dependencies.mongoose.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            const replay = await withSession(dependencies.OrderReconciliation.findOne({
                resolvedBy: normalized.actorId,
                requestId: normalized.requestId,
            }), session);
            if (replay) {
                if (String(replay.orderId) !== String(normalized.orderId)) {
                    throw new OrderReconciliationError('Idempotency key belongs to another order', 'IDEMPOTENCY_CONFLICT', 409);
                }
                const replayOrder = await withSession(dependencies.Order.findById(normalized.orderId), session);
                result = { order: replayOrder, reconciliation: replay, idempotentReplay: true };
                return;
            }
            const existingResolution = await withSession(
                dependencies.OrderReconciliation.findOne({ orderId: normalized.orderId }),
                session
            );
            if (existingResolution) {
                throw new OrderReconciliationError('Order reconciliation was already resolved', 'RECONCILIATION_ALREADY_RESOLVED', 409);
            }
            const order = await withSession(dependencies.Order.findById(normalized.orderId), session);
            if (!order) throw new OrderReconciliationError('Order not found', 'ORDER_NOT_FOUND', 404);
            if (order.lifecycleStatus !== 'RECONCILIATION_REQUIRED' || order.fundingStatus !== 'DEBITED') {
                throw new OrderReconciliationError('Order is not eligible for reconciliation', 'RECONCILIATION_NOT_REQUIRED', 409);
            }
            const context = await loadDripContext(order, dependencies, session);
            const now = new Date();
            const transition = resolution === 'CONFIRMED_ACCEPTED'
                ? await resolveAccepted(order, context, normalized, dependencies, session, now)
                : await resolveNotAccepted(order, context, normalized, dependencies, session, now);
            const [reconciliation] = await dependencies.OrderReconciliation.create([{
                orderId: order._id,
                workflowKind: context.workflowKind,
                dripFeedRunId: transition.dripFeedRunId,
                resolution,
                providerOrderId: normalized.providerOrderId,
                evidenceNote: normalized.evidenceNote,
                evidenceUrl: normalized.evidenceUrl,
                refundAmountMinor: transition.refundAmountMinor,
                resolvedBy: normalized.actorId,
                requestId: normalized.requestId,
                resolvedAt: now,
            }], { session });
            await dependencies.appendOrderEvent({
                orderId: order._id,
                userId: order.user,
                eventType: 'RECONCILIATION_RESOLVED',
                metadata: {
                    resolution,
                    status: transition.order.lifecycleStatus,
                    refundAmountMinor: transition.refundAmountMinor,
                },
                session,
            });
            await dependencies.AuditLog.create([{
                action: 'ORDER_RECONCILIATION_RESOLVED',
                actorType: 'ADMIN',
                actorId: normalized.actorId,
                targetType: 'Order',
                targetId: String(order._id),
                requestId: normalized.requestId,
                before: {
                    lifecycleStatus: 'RECONCILIATION_REQUIRED',
                    fundingStatus: order.fundingStatus,
                },
                after: {
                    lifecycleStatus: transition.order.lifecycleStatus,
                    fundingStatus: transition.order.fundingStatus,
                    resolution,
                    providerOrderId: normalized.providerOrderId,
                    refundAmountMinor: transition.refundAmountMinor,
                },
                metadata: {
                    reconciliationId: String(reconciliation._id),
                    workflowKind: context.workflowKind,
                    evidenceUrl: normalized.evidenceUrl,
                },
            }], { session });
            result = { order: transition.order, reconciliation, idempotentReplay: false };
        });
        return result;
    } catch (error) {
        if (error?.code === 11000) {
            throw new OrderReconciliationError('Provider order ID or reconciliation was already recorded', 'RECONCILIATION_CONFLICT', 409);
        }
        throw error;
    } finally {
        await session.endSession();
    }
}

module.exports = {
    OrderReconciliationError,
    resolveOrderReconciliation,
};
