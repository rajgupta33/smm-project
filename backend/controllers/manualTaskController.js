const ManualTask = require('../models/ManualTask');
const {
    MANUAL_TASK_STATUSES,
    ManualTaskError,
    claimManualTask,
    updateManualTask,
} = require('../services/manualTaskService');

function sendError(res, error) {
    const known = error instanceof ManualTaskError;
    return res.status(known ? error.statusCode : 500).json({
        success: false,
        error: known ? error.message : 'Manual task operation failed',
        code: known ? error.code : 'MANUAL_TASK_OPERATION_FAILED',
    });
}

function pagination(query) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
    return { page, limit, skip: (page - 1) * limit };
}

class ManualTaskController {
    async listTasks(req, res) {
        try {
            const status = req.query.status?.toUpperCase();
            if (status && !MANUAL_TASK_STATUSES.includes(status)) {
                throw new ManualTaskError('status is invalid', 'INVALID_MANUAL_TASK_STATUS');
            }
            const { page, limit, skip } = pagination(req.query);
            const filter = status ? { status } : {};
            const [tasks, total] = await Promise.all([
                ManualTask.find(filter)
                    .populate({
                        path: 'orderId',
                        select: 'orderId quantity rate target pricingSnapshot.sellingTotalMinor catalogueServiceId service user createdAt',
                        populate: { path: 'user', select: 'userId' },
                    })
                    .populate('assignedTo', 'userId')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
                ManualTask.countDocuments(filter),
            ]);
            return res.json({
                success: true,
                tasks,
                total,
                page,
                pages: Math.ceil(total / limit),
            });
        } catch (error) {
            return sendError(res, error);
        }
    }

    async assignTask(req, res) {
        try {
            const result = await claimManualTask({
                taskId: req.params.taskId,
                adminId: req.currentUser._id,
            });
            return res.json({
                success: true,
                task: result.task,
                idempotentReplay: result.idempotentReplay,
            });
        } catch (error) {
            return sendError(res, error);
        }
    }

    async updateTask(req, res) {
        try {
            const result = await updateManualTask({
                taskId: req.params.taskId,
                adminId: req.currentUser._id,
                status: req.body?.status,
                notes: req.body?.notes,
                proof: req.body?.proof,
                dueAt: req.body?.dueAt,
            });
            return res.json({
                success: true,
                task: result.task,
                idempotentReplay: result.idempotentReplay,
            });
        } catch (error) {
            return sendError(res, error);
        }
    }
}

module.exports = new ManualTaskController();
