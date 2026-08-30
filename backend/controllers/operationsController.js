const JobDispatch = require('../models/JobDispatch');
const Order = require('../models/Order');
const DripFeedOrder = require('../models/DripFeedOrder');
const DripFeedRun = require('../models/DripFeedRun');
const { resolveOrderReconciliation } = require('../services/orderReconciliationService');
const { randomUUID } = require('crypto');
const { getQueueDiagnostics, getRedisReadiness, getWorkerHeartbeat } = require('../queues/queueRegistry');

function safeLimit(value, fallback = 50) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : fallback;
}

class OperationsController {
    async getDiagnostics(req, res) {
        void req;
        try {
            const [redis, worker, queues, durablePending, reconciliationRequired] = await Promise.all([
                getRedisReadiness(),
                getWorkerHeartbeat(),
                getQueueDiagnostics(),
                JobDispatch.countDocuments({ status: { $in: ['PENDING', 'DISPATCHING'] } }),
                Order.countDocuments({ lifecycleStatus: 'RECONCILIATION_REQUIRED' }),
            ]);
            return res.status(200).json({
                success: true,
                data: { redis, worker, queues, durablePending, reconciliationRequired },
            });
        } catch {
            return res.status(503).json({
                success: false,
                error: { code: 'OPERATIONS_DIAGNOSTICS_UNAVAILABLE', message: 'Operations diagnostics are unavailable' },
            });
        }
    }

    async getJobDispatches(req, res) {
        const allowedStatuses = ['PENDING', 'DISPATCHING', 'ENQUEUED'];
        if (req.query.status && !allowedStatuses.includes(req.query.status)) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_JOB_STATUS', message: 'Job dispatch status is invalid' },
            });
        }
        const filter = req.query.status ? { status: req.query.status } : {};
        try {
            const data = await JobDispatch.find(filter)
                .sort({ createdAt: -1 })
                .limit(safeLimit(req.query.limit))
                .select('-payload')
                .lean();
            res.status(200).json({ success: true, data });
        } catch {
            res.status(500).json({
                success: false,
                error: { code: 'JOB_DISPATCH_READ_FAILED', message: 'Job dispatches could not be loaded' },
            });
        }
    }

    async getReconciliationOrders(req, res) {
        try {
            const orders = await Order.find({ lifecycleStatus: 'RECONCILIATION_REQUIRED' })
                .sort({ reconciliationRequiredAt: -1, updatedAt: -1 })
                .limit(safeLimit(req.query.limit))
                .select('orderId localOrderId user service providerId providerServiceId providerOrderId quantity fundingStatus lifecycleStatus reconciliationReason reconciliationRequiredAt submissionAttempt pricingSnapshot createdAt updatedAt')
                .populate('providerId', 'name code')
                .lean();
            const parents = orders.length ? await DripFeedOrder.find({
                orderId: { $in: orders.map((order) => order._id) },
                status: 'RECONCILIATION_REQUIRED',
            }).lean() : [];
            const parentByOrder = new Map(parents.map((parent) => [String(parent.orderId), parent]));
            const runs = parents.length ? await DripFeedRun.find({
                parentId: { $in: parents.map((parent) => parent._id) },
                status: 'RECONCILIATION_REQUIRED',
            }).select('parentId runNumber allocatedAmountMinor status').lean() : [];
            const runByParent = new Map(runs.map((run) => [String(run.parentId), run]));
            const data = orders.map((order) => {
                const parent = parentByOrder.get(String(order._id));
                const run = parent ? runByParent.get(String(parent._id)) : null;
                return {
                    ...order,
                    reconciliationContext: parent ? {
                        workflowKind: 'DRIP_FEED',
                        runNumber: run?.runNumber || null,
                        totalRuns: parent.totalRuns,
                        refundEligibleMinor: parent.reservedAmountMinor - parent.acceptedAmountMinor,
                    } : {
                        workflowKind: 'STANDARD',
                        refundEligibleMinor: order.pricingSnapshot?.sellingTotalMinor || null,
                    },
                };
            });
            res.status(200).json({ success: true, data });
        } catch {
            res.status(500).json({
                success: false,
                error: { code: 'RECONCILIATION_READ_FAILED', message: 'Reconciliation orders could not be loaded' },
            });
        }
    }

    async resolveReconciliationOrder(req, res) {
        try {
            const result = await resolveOrderReconciliation({
                orderId: req.params.orderId,
                actorId: req.currentUser._id,
                requestId: req.get('X-Request-Id')?.slice(0, 200) || randomUUID(),
                resolution: req.body?.resolution,
                providerOrderId: req.body?.providerOrderId,
                evidenceNote: req.body?.evidenceNote,
                evidenceUrl: req.body?.evidenceUrl,
            });
            return res.json({
                success: true,
                idempotentReplay: result.idempotentReplay,
                data: {
                    orderId: result.order._id,
                    localOrderId: result.order.localOrderId || result.order.orderId,
                    lifecycleStatus: result.order.lifecycleStatus,
                    fundingStatus: result.order.fundingStatus,
                    resolution: result.reconciliation.resolution,
                    providerOrderId: result.reconciliation.providerOrderId,
                    refundAmountMinor: result.reconciliation.refundAmountMinor,
                    resolvedAt: result.reconciliation.resolvedAt,
                },
            });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                success: false,
                error: {
                    code: error.code || 'RECONCILIATION_RESOLUTION_FAILED',
                    message: error.statusCode ? error.message : 'Order reconciliation could not be resolved',
                },
            });
        }
    }
}

module.exports = new OperationsController();
