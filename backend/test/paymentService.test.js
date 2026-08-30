const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createPaymentOrder, identifiers, parseTopupAmount,
    processVerifiedWebhook, reconcilePayment, validateSuccessfulObservation,
} = require('../services/paymentService');

function query(value) {
    return {
        select() { return this; },
        session: async () => value,
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function fakeMongoose() {
    return {
        async startSession() {
            return {
                async withTransaction(callback) { await callback(); },
                async endSession() {},
            };
        },
    };
}

test('top-up parsing stores paise and enforces configured server limits', () => {
    const config = { minTopupMinor: 10000, maxTopupMinor: 100000 };
    assert.equal(parseTopupAmount('123.45', config), 12345);
    assert.throws(() => parseTopupAmount('99.99', config), /between/);
    assert.throws(() => parseTopupAmount('100.001', config), /two decimal/);
});

test('a configured 1000-paise minimum permits exactly a ten-rupee top-up', () => {
    const config = { minTopupMinor: 1000, maxTopupMinor: 100000 };
    assert.equal(parseTopupAmount('10.00', config), 1000);
    assert.throws(
        () => parseTopupAmount('9.99', config),
        (error) => error.code === 'PAYMENT_AMOUNT_OUT_OF_RANGE'
    );
});

test('Cashfree identifiers are stable per user and client idempotency key', () => {
    assert.deepEqual(identifiers('user-1', 'request-1'), identifiers('user-1', 'request-1'));
    assert.notEqual(identifiers('user-1', 'request-1').merchantOrderId,
        identifiers('user-1', 'request-2').merchantOrderId);
});

test('an ambiguous existing create request is never blindly submitted again', async () => {
    let createCalls = 0;
    const existing = {
        _id: 'payment-1', userId: 'user-1', amountMinor: 50000, currency: 'INR',
        status: 'PENDING', merchantOrderId: 'pay_existing', paymentSessionId: null,
    };
    const result = await createPaymentOrder(
        { user: { _id: 'user-1' }, amount: '500', clientIdempotencyKey: 'request-1' },
        {
            Payment: { findOne: () => query(existing) },
            client: {
                config: { minTopupMinor: 10000, maxTopupMinor: 10000000 },
                async createOrder() { createCalls += 1; },
            },
        }
    );
    assert.equal(result.creationPending, true);
    assert.equal(createCalls, 0);
});

test('duplicate success webhooks credit the wallet exactly once', async () => {
    const state = { receipt: null, credits: 0 };
    const payment = {
        _id: 'payment-1', userId: 'user-1', merchantOrderId: 'pay_abc',
        amountMinor: 50000, currency: 'INR', status: 'PENDING', creditedAt: null,
    };
    const Payment = {
        findOne: () => query(payment),
        async findOneAndUpdate() {
            payment.creditedAt = new Date();
            payment.status = 'SUCCESS';
            return payment;
        },
        async updateOne() {},
    };
    const Receipt = {
        findOne: () => query(state.receipt),
        async create(documents) { state.receipt = documents[0]; return documents; },
    };
    const payload = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
            order: { order_id: 'pay_abc', order_amount: 500, order_currency: 'INR', order_status: 'PAID' },
            payment: { cf_payment_id: 'cf-payment-1', payment_status: 'SUCCESS', payment_amount: 500, payment_currency: 'INR' },
        },
    };
    const dependencies = {
        mongoose: fakeMongoose(), Payment, PaymentWebhookReceipt: Receipt,
        async creditWallet() { state.credits += 1; return { created: true, ledger: { _id: 'ledger-1' } }; },
    };
    await processVerifiedWebhook({ payload, eventKey: 'event-1' }, dependencies);
    let replay;
    for (let attempt = 1; attempt < 10; attempt += 1) {
        replay = await processVerifiedWebhook({ payload, eventKey: 'event-1' }, dependencies);
    }
    assert.equal(state.credits, 1);
    assert.equal(replay.duplicate, true);
});

test('a mismatched Cashfree amount or payment identity cannot settle a wallet', () => {
    const local = { merchantOrderId: 'pay_expected', amountMinor: 50000, currency: 'INR' };
    const validOrder = { order_id: 'pay_expected', cf_order_id: 'cf-order-1', order_amount: 500, order_currency: 'INR' };
    const validPayment = {
        cf_payment_id: 'cf-payment-1', payment_status: 'SUCCESS', payment_amount: 500, payment_currency: 'INR',
    };
    assert.throws(
        () => validateSuccessfulObservation(local, {
            order: { ...validOrder, order_amount: 499 }, payment: validPayment,
        }),
        (error) => error.code === 'PAYMENT_RECONCILIATION_REQUIRED'
    );
    assert.throws(
        () => validateSuccessfulObservation(local, {
            order: { ...validOrder, order_id: 'pay_other' }, payment: validPayment,
        }),
        (error) => error.code === 'PAYMENT_RECONCILIATION_REQUIRED'
    );
});

test('reconciliation credits only after Cashfree reports a matching paid order and success payment', async () => {
    let credits = 0;
    const payment = {
        _id: 'payment-2', userId: 'user-1', merchantOrderId: 'pay_reconcile',
        amountMinor: 75000, currency: 'INR', status: 'PENDING', creditedAt: null,
    };
    const Payment = {
        findById: () => query(payment),
        async findOneAndUpdate() { payment.status = 'SUCCESS'; payment.creditedAt = new Date(); return payment; },
    };
    const result = await reconcilePayment(payment._id, {
        Payment,
        mongoose: fakeMongoose(),
        async creditWallet() { credits += 1; return { created: true, ledger: { _id: 'ledger-2' } }; },
        client: {
            async getOrder() {
                return { order_id: 'pay_reconcile', cf_order_id: '123', order_status: 'PAID', order_amount: 750, order_currency: 'INR' };
            },
            async getPayments() {
                return [{ cf_payment_id: 'cf-payment-2', payment_status: 'SUCCESS', payment_amount: 750, payment_currency: 'INR' }];
            },
            async getRefunds() { return []; },
            async getDisputes() { return []; },
        },
    });
    assert.equal(credits, 1);
    assert.equal(result.payment.status, 'SUCCESS');
});

test('reconciliation records a successful refund without issuing another wallet credit', async () => {
    let credits = 0;
    const payment = {
        _id: 'payment-3', userId: 'user-1', merchantOrderId: 'pay_refund',
        amountMinor: 90000, currency: 'INR', status: 'SUCCESS', creditedAt: new Date(),
    };
    const Payment = {
        findById: () => query(payment),
        async findOneAndUpdate(filter, update) { void filter; Object.assign(payment, update.$set); return payment; },
    };
    const result = await reconcilePayment(payment._id, {
        Payment,
        mongoose: fakeMongoose(),
        async creditWallet() { credits += 1; },
        client: {
            async getOrder() {
                return { order_id: 'pay_refund', cf_order_id: '456', order_status: 'PAID', order_amount: 900, order_currency: 'INR' };
            },
            async getPayments() { return []; },
            async getRefunds() { return [{ refund_status: 'SUCCESS' }]; },
            async getDisputes() { return []; },
        },
    });
    assert.equal(result.payment.status, 'REFUNDED');
    assert.equal(credits, 0);
});

test('reconciliation closes an ambiguous create only after Cashfree proves the order is absent', async () => {
    const payment = {
        _id: 'payment-4', merchantOrderId: 'pay_absent', amountMinor: 50000,
        currency: 'INR', status: 'PENDING', creditedAt: null,
    };
    const Payment = {
        findById: () => query(payment),
        async findOneAndUpdate(filter, update) { void filter; Object.assign(payment, update.$set); return payment; },
    };
    const result = await reconcilePayment(payment._id, {
        Payment,
        client: {
            async getOrder() {
                const error = new Error('not found');
                error.code = 'order_not_found';
                error.gatewayStatus = 404;
                throw error;
            },
        },
    });
    assert.equal(result.payment.status, 'FAILED');
    assert.equal(result.terminal, true);
});
