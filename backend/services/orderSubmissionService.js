const mongoose = require('mongoose');
const Order = require('../models/Order');
const Provider = require('../models/Provider');
const {
    getCurrentProviderAdapter,
    getProviderAdapterForProvider,
} = require('../providers/providerRegistry');
const { refundWallet } = require('./walletService');
const { appendOrderEvent } = require('./orderEventService');
const { recordProviderMetric } = require('./providerMetricsService');

function finishedAttempt(result, finishedAt = new Date()) {
    return {
        attemptNumber: 1,
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

async function markReconciliation(order, result, reason, dependencies) {
    const attempt = finishedAttempt({
        ...result,
        classification: 'AMBIGUOUS',
        failureKind: result.failureKind || 'PERSISTENCE_FAILURE',
        errorMessage: result.errorMessage || reason,
    });
    const update = {
        lifecycleStatus: 'RECONCILIATION_REQUIRED',
        lastStatus: 'Reconciliation required',
        reconciliationReason: reason,
        reconciliationRequiredAt: attempt.finishedAt,
        'submissionAttempt.finishedAt': attempt.finishedAt,
        'submissionAttempt.outcome': attempt.outcome,
        'submissionAttempt.failureKind': attempt.failureKind,
        'submissionAttempt.httpStatus': attempt.httpStatus,
        'submissionAttempt.responseSnapshot': attempt.responseSnapshot,
        'submissionAttempt.errorMessage': attempt.errorMessage,
    };
    try {
        await dependencies.Order.updateOne(
            { _id: order._id, lifecycleStatus: { $in: ['SUBMITTING', 'INTENT_COMMITTED'] } },
            { $set: update }
        );
    } catch {
        // The durable INTENT_COMMITTED/SUBMITTING state still prevents automatic resubmission.
    }
    
    if (order && order.user) {
        await dependencies.appendOrderEvent({
            orderId: order._id,
            userId: order.user,
            eventType: 'RECONCILIATION_REQUIRED',
            internalOnly: true,
            metadata: { reason }
        }).catch(err => console.error('Failed to append RECONCILIATION_REQUIRED event', err));
    }

    return { lifecycleStatus: 'RECONCILIATION_REQUIRED', result };
}

async function completeAccepted(order, result, dependencies) {
    try {
        const updated = await dependencies.Order.findOneAndUpdate(
            { _id: order._id, lifecycleStatus: 'SUBMITTING' },
            {
                $set: {
                    providerOrderId: result.providerOrderId,
                    lifecycleStatus: 'SUBMITTED',
                    lastStatus: 'Pending',
                    reconciliationReason: null,
                    reconciliationRequiredAt: null,
                    'submissionAttempt.finishedAt': new Date(),
                    'submissionAttempt.outcome': 'ACCEPTED',
                    'submissionAttempt.failureKind': null,
                    'submissionAttempt.httpStatus': result.httpStatus || null,
                    'submissionAttempt.responseSnapshot': result.responseSnapshot || null,
                    'submissionAttempt.errorMessage': null,
                },
            },
            { new: true, runValidators: true }
        );
        if (!updated) throw new Error('Accepted provider order could not be persisted');
        await dependencies.appendOrderEvent({
            orderId: order._id,
            userId: order.user,
            eventType: 'PROVIDER_ACCEPTED',
            metadata: { providerOrderId: result.providerOrderId }
        }).catch(err => console.error('Failed to append PROVIDER_ACCEPTED event', err));
        return { lifecycleStatus: 'SUBMITTED', order: updated, result };
    } catch {
        return markReconciliation(
            order,
            { ...result, failureKind: 'PERSISTENCE_FAILURE' },
            'Provider accepted the request but the acceptance could not be persisted',
            dependencies
        );
    }
}

async function completeRejected(order, result, dependencies) {
    const session = await dependencies.mongoose.startSession();
    try {
        let updated;
        await session.withTransaction(async () => {
            await dependencies.refundWallet({
                userId: order.user,
                amountMinor: order.pricingSnapshot.sellingTotalMinor,
                type: 'REFUND',
                sourceType: 'ORDER',
                sourceId: order.localOrderId || order.orderId,
                idempotencyKey: `order-refund:${order.localOrderId || order.orderId}`,
                actorType: 'SYSTEM',
                actorId: null,
                description: `Refund for rejected order ${order.localOrderId || order.orderId}`,
                session,
            });
            updated = await dependencies.Order.findOneAndUpdate(
                { _id: order._id, lifecycleStatus: 'SUBMITTING', fundingStatus: 'DEBITED' },
                {
                    $set: {
                        lifecycleStatus: 'PROVIDER_REJECTED',
                        fundingStatus: 'REFUNDED',
                        lastStatus: 'Rejected',
                        reconciliationReason: null,
                        reconciliationRequiredAt: null,
                        'submissionAttempt.finishedAt': new Date(),
                        'submissionAttempt.outcome': 'DEFINITIVE_REJECTION',
                        'submissionAttempt.failureKind': result.failureKind,
                        'submissionAttempt.httpStatus': result.httpStatus || null,
                        'submissionAttempt.responseSnapshot': result.responseSnapshot || null,
                        'submissionAttempt.errorMessage': result.errorMessage || null,
                    },
                },
                { new: true, runValidators: true, session }
            );
            if (!updated) throw new Error('Rejected order state could not be persisted');
            await dependencies.appendOrderEvent({
                orderId: order._id,
                userId: order.user,
                eventType: 'REFUND_COMPLETED',
                metadata: { amountMinor: order.pricingSnapshot.sellingTotalMinor, reason: 'PROVIDER_REJECTED' },
                session
            }).catch(err => console.error('Failed to append REFUND_COMPLETED event', err));
        });
        return { lifecycleStatus: 'PROVIDER_REJECTED', order: updated, result };
    } catch {
        return markReconciliation(
            order,
            { ...result, failureKind: 'PERSISTENCE_FAILURE' },
            'Provider rejected the request but the refund/state transition did not complete',
            dependencies
        );
    } finally {
        await session.endSession();
    }
}

async function completeAmbiguous(order, result, dependencies) {
    return markReconciliation(
        order,
        result,
        `Provider submission outcome is unknown (${result.failureKind})`,
        dependencies
    );
}

async function submitCommittedOrder(order, overrides = {}) {
    const dependencies = {
        mongoose,
        Order,
        Provider,
        getProviderAdapterForProvider,
        recordProviderMetric,
        appendOrderEvent,
        refundWallet,
        ...overrides,
    };
    const startedAt = new Date();
    const claimed = await dependencies.Order.findOneAndUpdate(
        { _id: order._id, lifecycleStatus: 'INTENT_COMMITTED', submissionAttempt: null },
        {
            $set: {
                lifecycleStatus: 'SUBMITTING',
                lastStatus: 'Submitting',
                submissionAttempt: {
                    attemptNumber: 1,
                    startedAt,
                    outcome: 'STARTED',
                },
            },
        },
        { new: true, runValidators: true }
    );
    if (!claimed) {
        if (order.lifecycleStatus === 'SUBMITTING') {
            return markReconciliation(
                order,
                { failureKind: 'INTERRUPTED_ATTEMPT' },
                'A provider submission worker was interrupted after claiming the one allowed attempt',
                dependencies
            );
        }
        return { lifecycleStatus: order.lifecycleStatus, order, alreadyClaimed: true };
    }

    await dependencies.appendOrderEvent({
        orderId: claimed._id,
        userId: claimed.user,
        eventType: 'PROVIDER_SUBMISSION_STARTED',
        internalOnly: true
    }).catch(err => console.error('Failed to append PROVIDER_SUBMISSION_STARTED event', err));

    
    let result;
    const requestStartTime = Date.now();
    let isTimeout = false;
    let providerCallStarted = false;
    try {
        let providerClient = dependencies.providerClient;
        if (!providerClient && claimed.providerId) {
            let providerQuery = dependencies.Provider.findById(claimed.providerId);
            if (typeof providerQuery?.select === 'function') {
                providerQuery = providerQuery.select('+credentialReference');
            }
            const provider = await providerQuery;
            providerClient = dependencies.getProviderAdapterForProvider(provider);
        }
        providerClient ||= getCurrentProviderAdapter();
        const submit = providerClient.placeOrder || providerClient.submitOrder;
        providerCallStarted = true;
        result = await submit.call(providerClient, {
            providerServiceId: claimed.providerServiceId,
            target: claimed.target,
            quantity: claimed.quantity,
        });
    } catch (e) {
        isTimeout = e.name === 'TimeoutError' || e.code === 'ETIMEDOUT';
        result = !providerCallStarted && e.name === 'ProviderConfigurationError'
            ? {
                classification: 'DEFINITIVE_REJECTION',
                failureKind: 'PROVIDER_CONFIGURATION',
                errorMessage: 'The selected provider is not configured for submission',
            }
            : {
                classification: 'AMBIGUOUS',
                failureKind: 'TRANSPORT',
                errorMessage: 'Provider network request failed completely',
            };
    } finally {
        isTimeout ||= result?.failureKind === 'TIMEOUT';
        const latencyMs = Date.now() - requestStartTime;
        if (claimed.providerId && providerCallStarted) {
            dependencies.recordProviderMetric(claimed.providerId, {
                success: result && result.classification === 'ACCEPTED',
                timeout: isTimeout,
                latencyMs
            }).catch(e => console.error('Failed to record metrics', e));
        }
    }

    if (result.classification === 'ACCEPTED') {
        return completeAccepted(claimed, result, dependencies);
    }
    if (result.classification === 'DEFINITIVE_REJECTION') {
        return completeRejected(claimed, result, dependencies);
    }
    return completeAmbiguous(claimed, result, dependencies);
}

module.exports = {
    submitCommittedOrder,
};
