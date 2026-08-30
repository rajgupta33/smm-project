require('dotenv').config();
require('./migrationSafety');

const JobDispatch = require('../models/JobDispatch');
const Order = require('../models/Order');
const ProviderSyncRun = require('../models/ProviderSyncRun');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');
const {
    orderDispatchDocument,
    providerSyncDispatchDocument,
} = require('../services/jobDispatchService');

function classifyLegacyOrder(order) {
    if (order.lifecycleStatus === 'INTENT_COMMITTED' && !order.submissionAttempt) {
        return 'QUEUE_SAFE_INTENT';
    }
    if (order.lifecycleStatus === 'SUBMITTING' ||
        (order.lifecycleStatus === 'INTENT_COMMITTED' && order.submissionAttempt)) {
        return 'RECONCILE_CLAIMED_ATTEMPT';
    }
    return 'IGNORE';
}

async function backfillOrder(order, action, migratedAt, summary) {
    if (action === 'QUEUE_SAFE_INTENT') {
        const document = orderDispatchDocument(order._id);
        const result = await JobDispatch.updateOne(
            { jobKey: document.jobKey },
            { $setOnInsert: document },
            { upsert: true }
        );
        summary.orderDispatchesCreated += result.upsertedCount;
        return;
    }
    if (action === 'RECONCILE_CLAIMED_ATTEMPT') {
        const result = await Order.updateOne(
            { _id: order._id, lifecycleStatus: { $in: ['INTENT_COMMITTED', 'SUBMITTING'] } },
            {
                $set: {
                    lifecycleStatus: 'RECONCILIATION_REQUIRED',
                    lastStatus: 'Reconciliation required',
                    reconciliationReason: 'Submission was already claimed before durable worker migration',
                    reconciliationRequiredAt: migratedAt,
                    'submissionAttempt.finishedAt': migratedAt,
                    'submissionAttempt.outcome': 'AMBIGUOUS',
                    'submissionAttempt.failureKind': 'INTERRUPTED_ATTEMPT',
                    'submissionAttempt.errorMessage': 'Legacy claimed attempt was not automatically resubmitted',
                },
            }
        );
        summary.ordersReconciled += result.modifiedCount;
    }
}

async function run() {
    const applyChanges = process.argv.includes('--apply');
    await connectToDatabase();
    const [orders, syncRuns] = await Promise.all([
        Order.find({ lifecycleStatus: { $in: ['INTENT_COMMITTED', 'SUBMITTING'] } }),
        ProviderSyncRun.find({ status: { $in: ['QUEUED', 'RUNNING'] } }),
    ]);
    const summary = {
        mode: applyChanges ? 'apply' : 'dry-run',
        ordersScanned: orders.length,
        safeOrderIntents: 0,
        claimedOrdersRequiringReconciliation: 0,
        syncRunsScanned: syncRuns.length,
        orderDispatchesCreated: 0,
        syncDispatchesCreated: 0,
        ordersReconciled: 0,
    };
    const migratedAt = new Date();

    for (const order of orders) {
        const action = classifyLegacyOrder(order);
        if (action === 'QUEUE_SAFE_INTENT') summary.safeOrderIntents += 1;
        if (action === 'RECONCILE_CLAIMED_ATTEMPT') {
            summary.claimedOrdersRequiringReconciliation += 1;
        }
        if (applyChanges) await backfillOrder(order, action, migratedAt, summary);
    }

    for (const run of syncRuns) {
        if (!applyChanges) continue;
        const document = providerSyncDispatchDocument(run._id);
        const result = await JobDispatch.updateOne(
            { jobKey: document.jobKey },
            { $setOnInsert: document },
            { upsert: true }
        );
        summary.syncDispatchesCreated += result.upsertedCount;
    }
    console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(async () => disconnectFromDatabase());
}

module.exports = { classifyLegacyOrder };
