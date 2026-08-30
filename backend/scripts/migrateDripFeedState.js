require('dotenv').config();
require('./migrationSafety');

const mongoose = require('mongoose');
const DripFeedOrder = require('../models/DripFeedOrder');
const DripFeedRun = require('../models/DripFeedRun');
const Order = require('../models/Order');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');

function classifyLegacyDripFeed(parent) {
    if (parent.workflowVersion === 2) return 'CURRENT';
    if (['COMPLETED', 'CANCELLED'].includes(parent.status)) return 'LEGACY_TERMINAL';
    return 'LEGACY_RECONCILIATION_REQUIRED';
}

async function migrateParent(parent, action, migratedAt, session) {
    if (action === 'CURRENT') return;
    if (action === 'LEGACY_TERMINAL') {
        await DripFeedOrder.updateOne(
            { _id: parent._id, workflowVersion: { $ne: 2 } },
            { $set: { workflowVersion: 2 } },
            { session }
        );
        return;
    }

    const reason = 'Legacy drip-feed execution cannot prove whether its pending provider attempt was submitted';
    await Promise.all([
        DripFeedOrder.updateOne(
            { _id: parent._id, workflowVersion: { $ne: 2 } },
            {
                $set: {
                    workflowVersion: 2,
                    status: 'RECONCILIATION_REQUIRED',
                    nextRunAt: null,
                },
            },
            { session }
        ),
        DripFeedRun.updateMany(
            { parentId: parent._id, status: { $in: ['PENDING', 'REJECTED'] } },
            {
                $set: {
                    status: 'RECONCILIATION_REQUIRED',
                    attemptCount: 1,
                    attempt: {
                        startedAt: migratedAt,
                        finishedAt: migratedAt,
                        outcome: 'AMBIGUOUS',
                        failureKind: 'INTERRUPTED_ATTEMPT',
                        errorMessage: reason,
                    },
                },
            },
            { session }
        ),
        Order.updateOne(
            { _id: parent.orderId, lifecycleStatus: 'DRIP_FEED' },
            {
                $set: {
                    lifecycleStatus: 'RECONCILIATION_REQUIRED',
                    lastStatus: 'Drip-feed reconciliation required',
                    reconciliationReason: reason,
                    reconciliationRequiredAt: migratedAt,
                },
            },
            { session }
        ),
    ]);
}

async function run() {
    const applyChanges = process.argv.includes('--apply');
    await connectToDatabase();
    const parents = await DripFeedOrder.find({ workflowVersion: { $ne: 2 } }).lean();
    const summary = {
        mode: applyChanges ? 'apply' : 'dry-run',
        scanned: parents.length,
        current: 0,
        legacyTerminal: 0,
        reconciliationRequired: 0,
    };
    const migratedAt = new Date();
    for (const parent of parents) {
        const action = classifyLegacyDripFeed(parent);
        if (action === 'CURRENT') summary.current += 1;
        if (action === 'LEGACY_TERMINAL') summary.legacyTerminal += 1;
        if (action === 'LEGACY_RECONCILIATION_REQUIRED') summary.reconciliationRequired += 1;
        if (applyChanges) {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(() => migrateParent(parent, action, migratedAt, session));
            } finally {
                await session.endSession();
            }
        }
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

module.exports = { classifyLegacyDripFeed };
