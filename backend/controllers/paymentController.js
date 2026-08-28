const Payment = require('../models/Payment');
const { getRuntimeConfig } = require('../config/runtimeConfig');
const {
    createPaymentOrder, PaymentError, processVerifiedWebhook, reconcilePayment,
} = require('../services/paymentService');
const {
    CashfreeWebhookError, verifyCashfreeWebhook, webhookEventKey,
} = require('../services/cashfreeWebhookService');

function serializePayment(payment, { includeUser = false, includeSession = false } = {}) {
    const value = typeof payment?.toObject === 'function' ? payment.toObject() : payment;
    if (!value) return null;
    return {
        id: String(value._id),
        ...(includeUser ? {
            userId: String(value.userId?._id || value.userId),
            customerId: value.userId?.userId || null,
        } : {}),
        merchantOrderId: value.merchantOrderId,
        gateway: value.gateway,
        gatewayOrderId: value.gatewayOrderId || null,
        gatewayPaymentId: value.gatewayPaymentId || null,
        ...(includeSession ? { paymentSessionId: value.paymentSessionId || null } : {}),
        amountMinor: value.amountMinor,
        currency: value.currency,
        status: value.status,
        creditedAt: value.creditedAt || null,
        completedAt: value.completedAt || null,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}

function sendError(res, error) {
    const known = error instanceof PaymentError || error instanceof CashfreeWebhookError;
    return res.status(known ? error.statusCode : 500).json({
        error: known ? error.message : 'Payment operation failed',
        code: known ? error.code : 'PAYMENT_OPERATION_FAILED',
    });
}

function pagination(query) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
    return { page, limit, skip: (page - 1) * limit };
}

async function createOrder(req, res) {
    try {
        const result = await createPaymentOrder({
            user: req.currentUser,
            amount: req.body?.amount,
            clientIdempotencyKey: req.get('Idempotency-Key'),
        });
        const config = getRuntimeConfig().cashfree;
        return res.status(result.creationPending ? 202 : 200).json({
            data: serializePayment(result.payment, { includeSession: true }),
            creationPending: Boolean(result.creationPending),
            idempotentReplay: Boolean(result.idempotentReplay),
            checkoutMode: config.environment,
        });
    } catch (error) {
        return sendError(res, error);
    }
}

async function getConfig(req, res) {
    void req;
    const config = getRuntimeConfig().cashfree;
    return res.json({
        data: {
            currency: 'INR', checkoutMode: config.environment,
            minTopupMinor: config.minTopupMinor, maxTopupMinor: config.maxTopupMinor,
        },
    });
}

async function listMine(req, res) {
    try {
        const { page, limit, skip } = pagination(req.query);
        const [payments, total] = await Promise.all([
            Payment.find({ userId: req.currentUser._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Payment.countDocuments({ userId: req.currentUser._id }),
        ]);
        return res.json({ data: payments.map((payment) => serializePayment(payment)), page, limit, total });
    } catch (error) {
        return sendError(res, error);
    }
}

async function getMine(req, res) {
    try {
        const payment = await Payment.findOne({
            merchantOrderId: req.params.merchantOrderId,
            userId: req.currentUser._id,
        });
        if (!payment) throw new PaymentError('Payment not found', 'PAYMENT_NOT_FOUND', 404);
        return res.json({ data: serializePayment(payment) });
    } catch (error) {
        return sendError(res, error);
    }
}

async function cashfreeWebhook(req, res) {
    try {
        const signature = req.get('x-webhook-signature');
        const timestamp = req.get('x-webhook-timestamp');
        const payload = verifyCashfreeWebhook({ rawBody: req.body, signature, timestamp });
        const eventKey = webhookEventKey({
            idempotencyKey: req.get('x-idempotency-key'), signature, timestamp, rawBody: req.body,
        });
        const result = await processVerifiedWebhook({
            payload, eventKey, webhookVersion: req.get('x-webhook-version'),
        });
        return res.status(200).json({ received: true, duplicate: Boolean(result?.duplicate) });
    } catch (error) {
        return sendError(res, error);
    }
}

async function listAdmin(req, res) {
    try {
        const { page, limit, skip } = pagination(req.query);
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.merchantOrderId) filter.merchantOrderId = req.query.merchantOrderId;
        const [payments, total] = await Promise.all([
            Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'userId'),
            Payment.countDocuments(filter),
        ]);
        return res.json({
            data: payments.map((payment) => serializePayment(payment, { includeUser: true })),
            page, limit, total,
        });
    } catch (error) {
        return sendError(res, error);
    }
}

async function reconcileAdmin(req, res) {
    try {
        const result = await reconcilePayment(req.params.paymentId);
        return res.json({ data: serializePayment(result.payment, { includeUser: true }) });
    } catch (error) {
        return sendError(res, error);
    }
}

module.exports = {
    cashfreeWebhook, createOrder, getConfig, getMine, listAdmin, listMine, reconcileAdmin,
    serializePayment,
};
