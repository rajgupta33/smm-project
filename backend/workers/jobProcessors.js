const Order = require('../models/Order');
const Provider = require('../models/Provider');
const ProviderSyncRun = require('../models/ProviderSyncRun');
const Payment = require('../models/Payment');
const { submitCommittedOrder } = require('../services/orderSubmissionService');
const { createProviderSyncReport } = require('../services/providerSyncService');
const { reconcilePayment } = require('../services/paymentService');
const { scanRefillRequests, submitRefillRequest } = require('../services/refillService');

async function processOrderSubmissionJob(data, overrides = {}) {
    const OrderModel = overrides.Order || Order;
    const submit = overrides.submitCommittedOrder || submitCommittedOrder;
    const order = await OrderModel.findById(data.orderId);
    if (!order) throw new Error('Queued order no longer exists');
    return submit(order, overrides.submissionDependencies);
}

async function processProviderSyncJob(data, overrides = {}) {
    const SyncRun = overrides.ProviderSyncRun || ProviderSyncRun;
    const ProviderModel = overrides.Provider || Provider;
    const createReport = overrides.createProviderSyncReport || createProviderSyncReport;
    const attemptNumber = data.attemptNumber || 1;
    const maxAttempts = data.maxAttempts || 1;
    const run = await SyncRun.findById(data.runId);
    if (!run) throw new Error('Queued provider sync run no longer exists');
    if (run.status === 'COMPLETED' || run.status === 'FAILED') {
        return { runId: run._id, status: run.status, alreadyFinished: true };
    }

    let providerQuery = ProviderModel.findById(run.providerId);
    if (typeof providerQuery?.select === 'function') {
        providerQuery = providerQuery.select('+credentialReference');
    }
    const provider = await providerQuery;
    if (!provider) {
        await SyncRun.updateOne(
            { _id: run._id, status: { $in: ['QUEUED', 'RUNNING'] } },
            { $set: { status: 'FAILED', completedAt: new Date(), errorCode: 'PROVIDER_NOT_FOUND' } }
        );
        const error = new Error('Provider no longer exists');
        error.retryable = false;
        throw error;
    }

    await SyncRun.updateOne(
        { _id: run._id, status: { $in: ['QUEUED', 'RUNNING'] } },
        { $set: { status: 'RUNNING', startedAt: run.startedAt || new Date(), errorCode: null } }
    );

    try {
        const report = await createReport(provider);
        await SyncRun.updateOne(
            { _id: run._id, status: 'RUNNING' },
            {
                $set: {
                    status: 'COMPLETED', completedAt: new Date(),
                    counts: report.counts, report, errorCode: null,
                },
            }
        );
        await ProviderModel.updateOne(
            { _id: provider._id },
            { $set: { healthStatus: 'HEALTHY', lastSuccessfulSyncAt: new Date() } }
        );
        return { runId: run._id, status: 'COMPLETED', counts: report.counts };
    } catch (error) {
        const retryable = error.retryable !== false && (!error.statusCode || error.statusCode >= 500);
        const finalAttempt = !retryable || attemptNumber >= maxAttempts;
        await Promise.all([
            SyncRun.updateOne(
                { _id: run._id, status: 'RUNNING' },
                {
                    $set: {
                        status: finalAttempt ? 'FAILED' : 'QUEUED',
                        completedAt: finalAttempt ? new Date() : null,
                        errorCode: error.code || 'PROVIDER_SYNC_FAILED',
                    },
                }
            ),
            ProviderModel.updateOne(
                { _id: provider._id },
                { $set: { healthStatus: 'DEGRADED', lastFailureAt: new Date() } }
            ),
        ]);
        if (!retryable) error.retryable = false;
        throw error;
    }
}

async function processPaymentReconciliationJob(data, overrides = {}) {
    const reconcile = overrides.reconcilePayment || reconcilePayment;
    if (!data.paymentId) throw new Error('Payment reconciliation job requires paymentId');
    return reconcile(data.paymentId, overrides.reconciliationDependencies);
}

async function scanPendingPayments(overrides = {}) {
    const PaymentModel = overrides.Payment || Payment;
    const reconcile = overrides.reconcilePayment || reconcilePayment;
    const now = overrides.now || new Date();
    const payments = await PaymentModel.find({
        status: { $in: ['CREATED', 'PENDING', 'SUCCESS'] },
        nextReconcileAt: { $ne: null, $lte: now },
    }).sort({ nextReconcileAt: 1 }).limit(100).select('_id');
    const counts = { scanned: payments.length, reconciled: 0, failed: 0 };
    for (const payment of payments) {
        try {
            await reconcile(payment._id, overrides.reconciliationDependencies);
            counts.reconciled += 1;
        } catch (error) {
            counts.failed += 1;
            await PaymentModel.updateOne(
                { _id: payment._id, status: { $in: ['CREATED', 'PENDING', 'SUCCESS'] } },
                {
                    $set: {
                        gatewayErrorCode: error.code || 'PAYMENT_RECONCILIATION_FAILED',
                        nextReconcileAt: new Date(now.getTime() + 5 * 60 * 1000),
                    },
                    $inc: { reconciliationAttempts: 1 },
                }
            );
        }
    }
    return counts;
}

async function processRefillSubmissionJob(data, overrides = {}) {
    const submit = overrides.submitRefillRequest || submitRefillRequest;
    if (!data.refillRequestId) throw new Error('Refill job requires refillRequestId');
    return submit(data.refillRequestId, overrides.refillDependencies);
}

module.exports = {
    processOrderSubmissionJob, processPaymentReconciliationJob,
    processProviderSyncJob, scanPendingPayments,
    processRefillSubmissionJob, scanRefillRequests,
};
