const { createHash } = require('crypto');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const PaymentWebhookReceipt = require('../models/PaymentWebhookReceipt');
const { creditWallet } = require('./walletService');
const { createCashfreeClient, safeSnapshot } = require('./cashfreeClient');

class PaymentError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'PaymentError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function amountToMinorStrict(value, fieldName = 'amount') {
    const numeric = Number(value);
    const scaled = numeric * 100;
    const rounded = Math.round(scaled);
    if (!Number.isFinite(numeric) || numeric <= 0 ||
        !Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) {
        throw new PaymentError(`${fieldName} must be positive with at most two decimal places`, 'INVALID_PAYMENT_AMOUNT');
    }
    return rounded;
}

function parseTopupAmount(value, config) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) {
        throw new PaymentError('Top-up amount must have at most two decimal places', 'INVALID_PAYMENT_AMOUNT');
    }
    const amountMinor = amountToMinorStrict(value, 'Top-up amount');
    if (amountMinor < config.minTopupMinor || amountMinor > config.maxTopupMinor) {
        throw new PaymentError(
            `Top-up amount must be between ${config.minTopupMinor / 100} and ${config.maxTopupMinor / 100}`,
            'PAYMENT_AMOUNT_OUT_OF_RANGE'
        );
    }
    return amountMinor;
}

function identifiers(userId, clientKey) {
    const internalKey = `cashfree-create:${userId}:${clientKey}`;
    const hash = createHash('sha256').update(internalKey).digest('hex');
    const uuidHex = `${hash.slice(0, 12)}4${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
    return {
        idempotencyKey: internalKey,
        merchantOrderId: `pay_${hash.slice(0, 32)}`,
        gatewayIdempotencyKey: `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`,
    };
}

function assertGatewayOrder(payment, order, { requireSession = false, requireGatewayOrderId = false } = {}) {
    if ((requireGatewayOrderId && !order.cf_order_id) ||
        String(order.order_id || '') !== payment.merchantOrderId ||
        order.order_currency !== payment.currency ||
        amountToMinorStrict(order.order_amount, 'Cashfree order amount') !== payment.amountMinor ||
        (requireSession && !order.payment_session_id)) {
        throw new PaymentError('Cashfree order does not match the local payment', 'PAYMENT_RECONCILIATION_REQUIRED', 409);
    }
}

async function createPaymentOrder({ user, amount, clientIdempotencyKey }, overrides = {}) {
    const client = overrides.client || createCashfreeClient();
    const PaymentModel = overrides.Payment || Payment;
    if (typeof clientIdempotencyKey !== 'string' || !clientIdempotencyKey.trim() || clientIdempotencyKey.length > 200) {
        throw new PaymentError('A valid Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED');
    }
    const amountMinor = parseTopupAmount(amount, client.config);
    const ids = identifiers(user._id, clientIdempotencyKey.trim());
    let createdLocally = false;
    let payment = await PaymentModel.findOne({ idempotencyKey: ids.idempotencyKey })
        .select('+paymentSessionId +gatewayIdempotencyKey');
    if (payment && (String(payment.userId) !== String(user._id) || payment.amountMinor !== amountMinor)) {
        throw new PaymentError('Idempotency key is already used for another payment', 'IDEMPOTENCY_CONFLICT', 409);
    }
    if (!payment) {
        try {
            payment = await PaymentModel.create({
                userId: user._id,
                ...ids,
                amountMinor,
                currency: 'INR',
                status: 'CREATED',
                nextReconcileAt: new Date(),
            });
            createdLocally = true;
        } catch (error) {
            if (error.code !== 11000) throw error;
            payment = await PaymentModel.findOne({ idempotencyKey: ids.idempotencyKey })
                .select('+paymentSessionId +gatewayIdempotencyKey');
        }
    }
    if (payment.paymentSessionId) return { payment, idempotentReplay: true };
    if (!createdLocally) {
        return {
            payment,
            idempotentReplay: true,
            creationPending: ['CREATED', 'PENDING'].includes(payment.status),
        };
    }

    const body = {
        order_id: payment.merchantOrderId,
        order_amount: payment.amountMinor / 100,
        order_currency: payment.currency,
        customer_details: {
            customer_id: String(user._id),
            customer_phone: client.config.defaultCustomerPhone,
        },
        order_meta: {
            return_url: client.config.returnUrl,
            notify_url: client.config.notifyUrl,
        },
        order_note: 'Wallet top-up',
    };

    let order;
    try {
        order = await client.createOrder({ body, idempotencyKey: payment.gatewayIdempotencyKey });
    } catch (error) {
        if (error.code === 'order_already_exists') {
            order = await client.getOrder(payment.merchantOrderId);
        } else {
            await PaymentModel.updateOne(
                { _id: payment._id, status: 'CREATED' },
                {
                    $set: {
                        status: error.ambiguous ? 'PENDING' : 'FAILED',
                        gatewayErrorCode: error.code,
                        nextReconcileAt: error.ambiguous ? new Date() : null,
                        completedAt: error.ambiguous ? null : new Date(),
                    },
                }
            );
            if (error.ambiguous) return { payment: { ...payment.toObject(), status: 'PENDING' }, creationPending: true };
            throw error;
        }
    }

    assertGatewayOrder(payment, order, { requireSession: true, requireGatewayOrderId: true });
    payment = await PaymentModel.findOneAndUpdate(
        { _id: payment._id, creditedAt: null },
        {
            $set: {
                gatewayOrderId: String(order.cf_order_id),
                paymentSessionId: String(order.payment_session_id),
                status: 'PENDING',
                gatewayResponseSnapshot: safeSnapshot(order),
                gatewayErrorCode: null,
                nextReconcileAt: new Date(Date.now() + 60000),
            },
        },
        { new: true }
    ).select('+paymentSessionId');
    return { payment, idempotentReplay: false };
}

function validateSuccessfulObservation(payment, observation) {
    const order = observation.order;
    const gatewayPayment = observation.payment;
    assertGatewayOrder(payment, order);
    if (!gatewayPayment || gatewayPayment.payment_status !== 'SUCCESS' ||
        gatewayPayment.payment_currency !== payment.currency ||
        amountToMinorStrict(gatewayPayment.payment_amount, 'Cashfree payment amount') !== payment.amountMinor ||
        !gatewayPayment.cf_payment_id) {
        throw new PaymentError('Cashfree success details do not match the local payment', 'PAYMENT_RECONCILIATION_REQUIRED', 409);
    }
}

async function settleInSession(payment, observation, session, dependencies) {
    validateSuccessfulObservation(payment, observation);
    if (payment.creditedAt) return { payment, credited: false };
    const gatewayPaymentId = String(observation.payment.cf_payment_id);
    const wallet = await dependencies.creditWallet({
        userId: payment.userId,
        amountMinor: payment.amountMinor,
        type: 'PAYMENT',
        sourceType: 'CASHFREE_PAYMENT',
        sourceId: payment.merchantOrderId,
        idempotencyKey: `cashfree-credit:${payment.merchantOrderId}`,
        actorType: 'SYSTEM',
        actorId: null,
        description: `Cashfree wallet top-up ${payment.merchantOrderId}`,
        session,
    });
    const updated = await dependencies.Payment.findOneAndUpdate(
        { _id: payment._id, creditedAt: null },
        {
            $set: {
                status: 'SUCCESS', gatewayPaymentId,
                creditedAt: new Date(), walletLedgerId: wallet.ledger._id,
                completedAt: new Date(), lastReconciledAt: new Date(),
                nextReconcileAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                gatewayErrorCode: null,
                gatewayResponseSnapshot: {
                    order_id: observation.order.order_id,
                    order_status: observation.order.order_status || 'PAID',
                    cf_payment_id: gatewayPaymentId,
                    payment_status: observation.payment.payment_status,
                },
            },
        },
        { new: true, session, runValidators: true }
    );
    if (!updated) throw new PaymentError('Payment credit state changed concurrently', 'PAYMENT_STATE_CONFLICT', 409);
    return { payment: updated, credited: wallet.created };
}

async function settlePayment(paymentId, observation, overrides = {}) {
    const dependencies = {
        mongoose: overrides.mongoose || mongoose,
        Payment: overrides.Payment || Payment,
        creditWallet: overrides.creditWallet || creditWallet,
    };
    const session = await dependencies.mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            const payment = await dependencies.Payment.findById(paymentId).session(session);
            if (!payment) throw new PaymentError('Payment not found', 'PAYMENT_NOT_FOUND', 404);
            result = await settleInSession(payment, observation, session, dependencies);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

async function processVerifiedWebhook({ payload, eventKey, webhookVersion }, overrides = {}) {
    const dependencies = {
        mongoose: overrides.mongoose || mongoose,
        Payment: overrides.Payment || Payment,
        Receipt: overrides.PaymentWebhookReceipt || PaymentWebhookReceipt,
        creditWallet: overrides.creditWallet || creditWallet,
    };
    const order = payload?.data?.order;
    const gatewayPayment = payload?.data?.payment;
    const eventType = String(payload?.type || '');
    if (!order?.order_id || !eventType) {
        throw new PaymentError('Cashfree webhook payload is incomplete', 'INVALID_WEBHOOK_PAYLOAD');
    }
    const session = await dependencies.mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            const duplicate = await dependencies.Receipt.findOne({ eventKey }).session(session);
            if (duplicate) {
                result = { duplicate: true };
                return;
            }
            const payment = await dependencies.Payment.findOne({ merchantOrderId: String(order.order_id) }).session(session);
            if (!payment) throw new PaymentError('Cashfree order is unknown', 'PAYMENT_NOT_FOUND', 404);

            if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' && gatewayPayment?.payment_status === 'SUCCESS') {
                result = await settleInSession(payment, { order, payment: gatewayPayment }, session, dependencies);
            } else {
                assertGatewayOrder(payment, order);
                await dependencies.Payment.updateOne(
                    { _id: payment._id, creditedAt: null },
                    {
                        $set: {
                            status: 'PENDING',
                            gatewayPaymentId: gatewayPayment?.cf_payment_id
                                ? String(gatewayPayment.cf_payment_id) : payment.gatewayPaymentId,
                            gatewayErrorCode: gatewayPayment?.payment_status || eventType,
                            nextReconcileAt: new Date(Date.now() + 60000),
                        },
                    },
                    { session }
                );
                result = { payment, credited: false };
            }
            await dependencies.Receipt.create([{
                eventKey,
                paymentId: payment._id,
                eventType,
                gatewayPaymentId: gatewayPayment?.cf_payment_id
                    ? String(gatewayPayment.cf_payment_id) : null,
                webhookVersion: webhookVersion || null,
            }], { session });
        });
        return result;
    } finally {
        await session.endSession();
    }
}

async function reconcilePayment(paymentId, overrides = {}) {
    const PaymentModel = overrides.Payment || Payment;
    const client = overrides.client || createCashfreeClient();
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new PaymentError('Payment not found', 'PAYMENT_NOT_FOUND', 404);
    let order;
    try {
        order = await client.getOrder(payment.merchantOrderId);
    } catch (error) {
        if (error.gatewayStatus !== 404) throw error;
        const updated = await PaymentModel.findOneAndUpdate(
            { _id: payment._id, creditedAt: null },
            {
                $set: {
                    status: 'FAILED', gatewayErrorCode: error.code || 'CASHFREE_ORDER_NOT_FOUND',
                    lastReconciledAt: new Date(), nextReconcileAt: null, completedAt: new Date(),
                },
                $inc: { reconciliationAttempts: 1 },
            },
            { new: true }
        );
        return { payment: updated, terminal: true };
    }
    assertGatewayOrder(payment, order, { requireGatewayOrderId: true });
    if (order.order_status === 'PAID') {
        const [payments, refunds, disputes] = await Promise.all([
            client.getPayments(payment.merchantOrderId),
            client.getRefunds(payment.merchantOrderId),
            client.getDisputes(payment.merchantOrderId),
        ]);
        const successfulRefund = refunds.find((candidate) => candidate.refund_status === 'SUCCESS');
        const openDispute = disputes.find((candidate) =>
            !['DISPUTE_WON', 'DISPUTE_CLOSED'].includes(candidate.dispute_status));
        if (successfulRefund || openDispute) {
            const status = openDispute ? 'DISPUTED' : 'REFUNDED';
            const updated = await PaymentModel.findOneAndUpdate(
                { _id: payment._id },
                {
                    $set: {
                        status, lastReconciledAt: new Date(), nextReconcileAt: null,
                        gatewayErrorCode: openDispute?.dispute_status || successfulRefund?.refund_status || status,
                    },
                    $inc: { reconciliationAttempts: 1 },
                },
                { new: true }
            );
            return { payment: updated, terminal: true };
        }
        const successful = payments.find((candidate) => candidate.payment_status === 'SUCCESS');
        if (!successful) throw new PaymentError('Paid Cashfree order has no successful payment', 'PAYMENT_RECONCILIATION_REQUIRED', 409);
        return settlePayment(payment._id, { order, payment: successful }, overrides);
    }
    const status = order.order_status === 'EXPIRED'
        ? 'EXPIRED'
        : ['TERMINATED', 'TERMINATION_REQUESTED'].includes(order.order_status)
            ? 'FAILED'
            : 'PENDING';
    const terminal = status !== 'PENDING';
    const updated = await PaymentModel.findOneAndUpdate(
        { _id: payment._id, creditedAt: null },
        {
            $set: {
                status, gatewayOrderId: String(order.cf_order_id || payment.gatewayOrderId || ''),
                lastReconciledAt: new Date(),
                nextReconcileAt: terminal ? null : new Date(Date.now() + 60000),
                completedAt: terminal ? new Date() : null,
                gatewayResponseSnapshot: safeSnapshot(order),
            },
            $inc: { reconciliationAttempts: 1 },
        },
        { new: true }
    );
    return { payment: updated, terminal };
}

module.exports = {
    PaymentError,
    amountToMinorStrict,
    createPaymentOrder,
    identifiers,
    parseTopupAmount,
    processVerifiedWebhook,
    reconcilePayment,
    settlePayment,
    validateSuccessfulObservation,
};
