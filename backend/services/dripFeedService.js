const mongoose = require('mongoose');
const DripFeedOrder = require('../models/DripFeedOrder');
const DripFeedRun = require('../models/DripFeedRun');
const Order = require('../models/Order');
const Provider = require('../models/Provider');
const {
    getCurrentProviderAdapter,
    getProviderAdapterForProvider,
} = require('../providers/providerRegistry');
const { appendOrderEvent } = require('./orderEventService');
const { createDispatch, dripFeedDispatchDocument } = require('./jobDispatchService');
const { refundWallet } = require('./walletService');

function allocatedRunAmount(totalAmountMinor, totalRuns, runNumber) {
    if (![totalAmountMinor, totalRuns, runNumber].every(Number.isSafeInteger)
        || totalAmountMinor <= 0 || totalRuns <= 0 || runNumber <= 0 || runNumber > totalRuns) {
        throw new Error('Invalid drip-feed allocation input');
    }
    const baseAmount = Math.floor(totalAmountMinor / totalRuns);
    const remainder = totalAmountMinor % totalRuns;
    const amount = baseAmount + (runNumber <= remainder ? 1 : 0);
    if (amount <= 0) throw new Error('Each drip-feed run must be allocated at least one paise');
    return amount;
}

function pricingSnapshotForRun(order, runNumber, totalRuns) {
    const source = typeof order.pricingSnapshot?.toObject === 'function'
        ? order.pricingSnapshot.toObject()
        : { ...(order.pricingSnapshot || {}) };
    const allocatedAmountMinor = allocatedRunAmount(
        source.sellingTotalMinor,
        totalRuns,
        runNumber
    );
    return {
        allocatedAmountMinor,
        pricingSnapshot: source,
    };
}

function runDocument(parent, order, runNumber, scheduledAt) {
    const allocation = pricingSnapshotForRun(order, runNumber, parent.totalRuns);
    return {
        parentId: parent._id,
        runNumber,
        quantity: parent.quantityPerRun,
        scheduledAt,
        providerId: order.providerId || null,
        providerOfferId: order.providerOfferId || null,
        ...allocation,
        status: 'SCHEDULED',
        attemptCount: 0,
    };
}

async function createDripFeedSchedule({ order, quantityPerRun, totalRuns, intervalMinutes, session }, overrides = {}) {
    const ParentModel = overrides.DripFeedOrder || DripFeedOrder;
    const RunModel = overrides.DripFeedRun || DripFeedRun;
    const createOutbox = overrides.createDispatch || createDispatch;
    const scheduledAt = overrides.now || new Date();
    const [parent] = await ParentModel.create([{
        orderId: order._id,
        totalQuantity: order.quantity,
        quantityPerRun,
        totalRuns,
        completedRuns: 0,
        intervalMinutes,
        nextRunAt: scheduledAt,
        reservedAmountMinor: order.pricingSnapshot.sellingTotalMinor,
        acceptedAmountMinor: 0,
        refundedAmountMinor: 0,
        status: 'ACTIVE',
    }], { session });
    const [run] = await RunModel.create([
        runDocument(parent, order, 1, scheduledAt),
    ], { session });
    const dispatchDocument = dripFeedDispatchDocument(run._id, parent._id, 1, scheduledAt);
    await createOutbox(dispatchDocument, session);
    return { parent, run, dispatchDocument };
}

function finishedAttempt(result, finishedAt = new Date()) {
    return {
        finishedAt,
        outcome: result.classification === 'ACCEPTED'
            ? 'ACCEPTED'
            : result.classification === 'DEFINITIVE_REJECTION'
                ? 'DEFINITIVE_REJECTION'
                : 'AMBIGUOUS',
        failureKind: result.failureKind || null,
        httpStatus: result.httpStatus || null,
        responseSnapshot: result.responseSnapshot || null,
        errorMessage: result.errorMessage || null,
    };
}

function attemptUpdate(result) {
    const attempt = finishedAttempt(result);
    return {
        'attempt.finishedAt': attempt.finishedAt,
        'attempt.outcome': attempt.outcome,
        'attempt.failureKind': attempt.failureKind,
        'attempt.httpStatus': attempt.httpStatus,
        'attempt.responseSnapshot': attempt.responseSnapshot,
        'attempt.errorMessage': attempt.errorMessage,
    };
}

async function loadRelations(run, dependencies) {
    const parent = await dependencies.DripFeedOrder.findById(run.parentId);
    const order = parent ? await dependencies.Order.findById(parent.orderId) : null;
    return { parent, order };
}

async function markReconciliation(run, parent, order, result, reason, dependencies) {
    const reconciliationResult = {
        ...result,
        classification: 'AMBIGUOUS',
        failureKind: result.failureKind || 'PERSISTENCE_FAILURE',
        errorMessage: result.errorMessage || reason,
    };
    const timestamp = new Date();
    await Promise.allSettled([
        dependencies.DripFeedRun.updateOne(
            { _id: run._id, status: { $in: ['SCHEDULED', 'SUBMITTING'] } },
            { $set: { status: 'RECONCILIATION_REQUIRED', ...attemptUpdate(reconciliationResult) } }
        ),
        parent && dependencies.DripFeedOrder.updateOne(
            { _id: parent._id, status: 'ACTIVE' },
            { $set: { status: 'RECONCILIATION_REQUIRED', nextRunAt: null } }
        ),
        order && dependencies.Order.updateOne(
            { _id: order._id, lifecycleStatus: 'DRIP_FEED' },
            {
                $set: {
                    lifecycleStatus: 'RECONCILIATION_REQUIRED',
                    lastStatus: 'Drip-feed reconciliation required',
                    reconciliationReason: reason,
                    reconciliationRequiredAt: timestamp,
                },
            }
        ),
    ]);
    if (order) {
        await dependencies.appendOrderEvent({
            orderId: order._id,
            userId: order.user,
            eventType: 'RECONCILIATION_REQUIRED',
            internalOnly: true,
            metadata: { reason, runNumber: run.runNumber },
        }).catch(() => {});
    }
    return { lifecycleStatus: 'RECONCILIATION_REQUIRED', runStatus: 'RECONCILIATION_REQUIRED' };
}

async function completeAccepted(run, parent, order, result, dependencies) {
    const session = await dependencies.mongoose.startSession();
    try {
        let finalRun;
        let nextDispatchDocument = null;
        await session.withTransaction(async () => {
            finalRun = await dependencies.DripFeedRun.findOneAndUpdate(
                { _id: run._id, status: 'SUBMITTING', attemptCount: 1 },
                {
                    $set: {
                        status: 'SUBMITTED',
                        providerOrderId: result.providerOrderId,
                        ...attemptUpdate(result),
                    },
                },
                { new: true, runValidators: true, session }
            );
            if (!finalRun) throw new Error('Accepted drip-feed run could not be persisted');

            const finalRunNumber = run.runNumber === parent.totalRuns;
            const nextRunAt = finalRunNumber
                ? null
                : new Date(Date.now() + parent.intervalMinutes * 60000);
            const updatedParent = await dependencies.DripFeedOrder.findOneAndUpdate(
                { _id: parent._id, status: 'ACTIVE', completedRuns: run.runNumber - 1 },
                {
                    $set: { status: finalRunNumber ? 'COMPLETED' : 'ACTIVE', nextRunAt },
                    $inc: { completedRuns: 1, acceptedAmountMinor: run.allocatedAmountMinor },
                },
                { new: true, runValidators: true, session }
            );
            if (!updatedParent) throw new Error('Drip-feed parent progress could not be persisted');

            if (finalRunNumber) {
                const completedOrder = await dependencies.Order.findOneAndUpdate(
                    { _id: order._id, lifecycleStatus: 'DRIP_FEED' },
                    {
                        $set: {
                            lifecycleStatus: 'COMPLETED',
                            lastStatus: 'Completed',
                            reconciliationReason: null,
                            reconciliationRequiredAt: null,
                        },
                    },
                    { new: true, runValidators: true, session }
                );
                if (!completedOrder) throw new Error('Completed drip-feed order could not be persisted');
            } else {
                const nextRunNumber = run.runNumber + 1;
                const [nextRun] = await dependencies.DripFeedRun.create([
                    runDocument(parent, order, nextRunNumber, nextRunAt),
                ], { session });
                nextDispatchDocument = dripFeedDispatchDocument(
                    nextRun._id,
                    parent._id,
                    nextRunNumber,
                    nextRunAt
                );
                await dependencies.createDispatch(nextDispatchDocument, session);
                await dependencies.Order.updateOne(
                    { _id: order._id, lifecycleStatus: 'DRIP_FEED' },
                    { $set: { lastStatus: `Drip-feed run ${run.runNumber} of ${parent.totalRuns} submitted` } },
                    { session }
                );
            }

            await dependencies.appendOrderEvent({
                orderId: order._id,
                userId: order.user,
                eventType: 'STATUS_CHANGED',
                metadata: {
                    status: finalRunNumber ? 'COMPLETED' : 'DRIP_FEED',
                    runNumber: run.runNumber,
                    totalRuns: parent.totalRuns,
                    quantity: run.quantity,
                },
                session,
            });
        });
        return {
            lifecycleStatus: run.runNumber === parent.totalRuns ? 'COMPLETED' : 'DRIP_FEED',
            runStatus: 'SUBMITTED',
            run: finalRun,
            nextDispatchDocument,
        };
    } catch {
        return markReconciliation(
            run,
            parent,
            order,
            { ...result, failureKind: 'PERSISTENCE_FAILURE' },
            'Provider accepted a drip-feed run but its result could not be persisted',
            dependencies
        );
    } finally {
        await session.endSession();
    }
}

async function completeRejected(run, parent, order, result, dependencies) {
    const session = await dependencies.mongoose.startSession();
    const refundAmountMinor = parent.reservedAmountMinor - parent.acceptedAmountMinor;
    try {
        await session.withTransaction(async () => {
            await dependencies.refundWallet({
                userId: order.user,
                amountMinor: refundAmountMinor,
                type: 'REFUND',
                sourceType: 'ORDER',
                sourceId: order.localOrderId || order.orderId,
                idempotencyKey: `drip-refund:${order.localOrderId || order.orderId}`,
                actorType: 'SYSTEM',
                actorId: null,
                description: `Refund for unexecuted drip-feed runs on ${order.localOrderId || order.orderId}`,
                session,
            });
            const rejectedRun = await dependencies.DripFeedRun.findOneAndUpdate(
                { _id: run._id, status: 'SUBMITTING', attemptCount: 1 },
                { $set: { status: 'REJECTED', ...attemptUpdate(result) } },
                { new: true, runValidators: true, session }
            );
            if (!rejectedRun) throw new Error('Rejected drip-feed run could not be persisted');
            const cancelledParent = await dependencies.DripFeedOrder.findOneAndUpdate(
                { _id: parent._id, status: 'ACTIVE' },
                {
                    $set: {
                        status: 'CANCELLED',
                        nextRunAt: null,
                        refundedAmountMinor: refundAmountMinor,
                    },
                },
                { new: true, runValidators: true, session }
            );
            if (!cancelledParent) throw new Error('Cancelled drip-feed parent could not be persisted');
            const fundingStatus = parent.acceptedAmountMinor > 0 ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
            const cancelledOrder = await dependencies.Order.findOneAndUpdate(
                { _id: order._id, lifecycleStatus: 'DRIP_FEED', fundingStatus: 'DEBITED' },
                {
                    $set: {
                        lifecycleStatus: 'CANCELLED',
                        fundingStatus,
                        lastStatus: 'Drip-feed cancelled and unexecuted value refunded',
                    },
                },
                { new: true, runValidators: true, session }
            );
            if (!cancelledOrder) throw new Error('Cancelled drip-feed order could not be persisted');
            await dependencies.appendOrderEvent({
                orderId: order._id,
                userId: order.user,
                eventType: 'REFUND_COMPLETED',
                metadata: {
                    amountMinor: refundAmountMinor,
                    reason: 'DRIP_FEED_PROVIDER_REJECTION',
                    runNumber: run.runNumber,
                },
                session,
            });
        });
        return { lifecycleStatus: 'CANCELLED', runStatus: 'REJECTED', refundAmountMinor };
    } catch {
        return markReconciliation(
            run,
            parent,
            order,
            { ...result, failureKind: 'PERSISTENCE_FAILURE' },
            'Provider rejected a drip-feed run but its refund/state transition did not complete',
            dependencies
        );
    } finally {
        await session.endSession();
    }
}

async function processDripFeedRun(runId, overrides = {}) {
    const dependencies = {
        mongoose,
        DripFeedOrder,
        DripFeedRun,
        Order,
        Provider,
        getProviderAdapterForProvider,
        appendOrderEvent,
        createDispatch,
        refundWallet,
        ...overrides,
    };
    let run = await dependencies.DripFeedRun.findById(runId);
    if (!run) throw new Error('Queued drip-feed run no longer exists');
    let { parent, order } = await loadRelations(run, dependencies);
    if (!parent || !order) throw new Error('Queued drip-feed run has missing parent data');

    if (run.status === 'SUBMITTING') {
        return markReconciliation(
            run,
            parent,
            order,
            { failureKind: 'INTERRUPTED_ATTEMPT' },
            'A drip-feed worker was interrupted after claiming the one allowed provider attempt',
            dependencies
        );
    }
    if (run.status !== 'SCHEDULED' || parent.status !== 'ACTIVE' || order.lifecycleStatus !== 'DRIP_FEED') {
        return { lifecycleStatus: order.lifecycleStatus, runStatus: run.status, alreadyHandled: true };
    }

    run = await dependencies.DripFeedRun.findOneAndUpdate(
        { _id: run._id, status: 'SCHEDULED', attemptCount: 0 },
        {
            $set: {
                status: 'SUBMITTING',
                attempt: { startedAt: new Date(), outcome: 'STARTED' },
            },
            $inc: { attemptCount: 1 },
        },
        { new: true, runValidators: true }
    );
    if (!run) {
        const current = await dependencies.DripFeedRun.findById(runId);
        if (current?.status === 'SUBMITTING') {
            ({ parent, order } = await loadRelations(current, dependencies));
            return markReconciliation(
                current,
                parent,
                order,
                { failureKind: 'INTERRUPTED_ATTEMPT' },
                'A concurrent worker already claimed this drip-feed attempt',
                dependencies
            );
        }
        return { lifecycleStatus: order.lifecycleStatus, runStatus: current?.status, alreadyHandled: true };
    }

    let result;
    let providerCallStarted = false;
    try {
        let adapter = dependencies.providerAdapter;
        if (!adapter && order.providerId) {
            let providerQuery = dependencies.Provider.findById(order.providerId);
            if (typeof providerQuery?.select === 'function') {
                providerQuery = providerQuery.select('+credentialReference');
            }
            const provider = await providerQuery;
            adapter = dependencies.getProviderAdapterForProvider(provider);
        }
        adapter ||= getCurrentProviderAdapter();
        providerCallStarted = true;
        result = await adapter.placeOrder({
            providerServiceId: order.providerServiceId,
            target: order.target,
            quantity: run.quantity,
        });
    } catch (error) {
        result = !providerCallStarted && error.name === 'ProviderConfigurationError'
            ? {
                classification: 'DEFINITIVE_REJECTION',
                failureKind: 'PROVIDER_CONFIGURATION',
                errorMessage: 'The selected provider is not configured for submission',
            }
            : {
                classification: 'AMBIGUOUS',
                failureKind: 'TRANSPORT',
                errorMessage: 'Provider request outcome is unknown',
            };
    }
    if (result.classification === 'ACCEPTED') {
        return completeAccepted(run, parent, order, result, dependencies);
    }
    if (result.classification === 'DEFINITIVE_REJECTION') {
        return completeRejected(run, parent, order, result, dependencies);
    }
    return markReconciliation(
        run,
        parent,
        order,
        result,
        `Drip-feed provider outcome is unknown (${result.failureKind || 'UNKNOWN'})`,
        dependencies
    );
}

module.exports = {
    allocatedRunAmount,
    createDripFeedSchedule,
    pricingSnapshotForRun,
    processDripFeedRun,
};
