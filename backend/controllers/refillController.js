const mongoose = require('mongoose');
const Order = require('../models/Order');
const RefillRequest = require('../models/RefillRequest');
const Provider = require('../models/Provider');
const {
    getCurrentProviderAdapter,
    getProviderAdapterForProvider,
} = require('../providers/providerRegistry');
const {
    createRefillRequest, pollRefillStatus, RefillError,
} = require('../services/refillService');

function serialize(refill, includeInternal = false) {
    const value = typeof refill?.toObject === 'function' ? refill.toObject() : refill;
    if (!value) return null;
    return {
        id: String(value._id),
        orderId: String(value.orderId?._id || value.orderId),
        ...(value.orderId?.orderId ? { publicOrderId: value.orderId.orderId } : {}),
        ...(includeInternal ? {
            userId: String(value.userId?._id || value.userId),
            customerId: value.userId?.userId || null,
            providerId: String(value.providerId),
            providerOrderId: value.providerOrderId,
            providerRefillId: value.providerRefillId || null,
            failureReason: value.failureReason,
        } : {}),
        status: value.status,
        requestedAt: value.requestedAt,
        cooldownUntil: value.cooldownUntil,
        expiresAt: value.expiresAt,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}

function sendError(res, error) {
    const known = error instanceof RefillError;
    return res.status(known ? error.statusCode : 500).json({
        success: false,
        error: known ? error.message : 'Refill operation failed',
        code: known ? error.code : 'REFILL_OPERATION_FAILED',
    });
}

async function create(req, res) {
    try {
        const result = await createRefillRequest({
            userId: req.currentUser._id,
            publicOrderId: req.body?.orderId,
            clientIdempotencyKey: req.get('Idempotency-Key'),
        });
        return res.status(202).json({
            success: true, data: serialize(result.refill),
            idempotentReplay: Boolean(result.idempotentReplay),
            queueDispatchPending: Boolean(result.queueDispatchPending),
        });
    } catch (error) {
        if (error?.code === 11000) {
            const replay = await RefillRequest.findOne({
                userId: req.currentUser._id,
                idempotencyKey: req.get('Idempotency-Key')?.trim(),
            });
            if (replay) return res.status(202).json({ success: true, data: serialize(replay), idempotentReplay: true });
        }
        return sendError(res, error);
    }
}

async function listMine(req, res) {
    try {
        const data = await RefillRequest.find({ userId: req.currentUser._id })
            .sort({ createdAt: -1 }).limit(100);
        return res.json({ success: true, data: data.map((value) => serialize(value)) });
    } catch (error) { return sendError(res, error); }
}

async function getMine(req, res) {
    try {
        if (!mongoose.isValidObjectId(req.params.refillRequestId)) {
            throw new RefillError('Refill request ID is invalid', 'INVALID_REFILL_ID');
        }
        const refill = await RefillRequest.findOne({
            _id: req.params.refillRequestId, userId: req.currentUser._id,
        });
        if (!refill) throw new RefillError('Refill request not found', 'REFILL_NOT_FOUND', 404);
        return res.json({ success: true, data: serialize(refill) });
    } catch (error) { return sendError(res, error); }
}

async function legacyStatus(req, res) {
    try {
        const identifier = req.body?.refillRequestId || req.body?.orderId;
        if (!identifier) throw new RefillError('Refill request ID is required', 'INVALID_REFILL_ID');
        let refill = mongoose.isValidObjectId(identifier)
            ? await RefillRequest.findOne({ _id: identifier, userId: req.currentUser._id })
            : null;
        if (!refill) {
            const order = await Order.findOne({
                user: req.currentUser._id,
                $or: [{ orderId: identifier }, { refill: identifier }],
            });
            if (!order) throw new RefillError('Refill request not found', 'REFILL_NOT_FOUND', 404);
            if (!order.refill) throw new RefillError('No refill request exists for this order', 'REFILL_NOT_FOUND', 404);
            let adapter = getCurrentProviderAdapter();
            if (order.providerId) {
                const provider = await Provider.findById(order.providerId)
                    .select('+credentialReference');
                adapter = getProviderAdapterForProvider(provider);
            }
            const providerStatus = await adapter.getRefillStatus(order.refill);
            return res.json({ success: true, data: { status: providerStatus.status, legacy: true } });
        }
        return res.json({ success: true, data: serialize(refill) });
    } catch (error) { return sendError(res, error); }
}

async function listAdmin(req, res) {
    try {
        const filter = req.query.status ? { status: req.query.status } : {};
        const data = await RefillRequest.find(filter).sort({ createdAt: -1 }).limit(200)
            .populate('userId', 'userId').populate('orderId', 'orderId');
        return res.json({ success: true, data: data.map((value) => serialize(value, true)) });
    } catch (error) { return sendError(res, error); }
}

async function pollAdmin(req, res) {
    try {
        const result = await pollRefillStatus(req.params.refillRequestId);
        return res.json({ success: true, data: serialize(result.refill, true) });
    } catch (error) { return sendError(res, error); }
}

module.exports = { create, getMine, legacyStatus, listAdmin, listMine, pollAdmin, serialize };
