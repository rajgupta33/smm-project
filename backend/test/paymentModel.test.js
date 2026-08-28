const assert = require('node:assert/strict');
const test = require('node:test');

const Payment = require('../models/Payment');
const PaymentWebhookReceipt = require('../models/PaymentWebhookReceipt');

test('payment records protect gateway identifiers and idempotency in the database', () => {
    const indexes = Payment.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.merchantOrderId === 1 && options.unique));
    assert.ok(indexes.some(([fields, options]) => fields.idempotencyKey === 1 && options.unique));
    assert.ok(indexes.some(([fields, options]) => fields.gatewayPaymentId === 1 && options.unique && options.sparse));
    assert.equal(Payment.schema.path('paymentSessionId').options.select, false);
    assert.equal(Payment.schema.path('gatewayIdempotencyKey').options.select, false);
    assert.equal(Payment.schema.path('amountMinor').options.immutable, true);
    assert.ok(PaymentWebhookReceipt.schema.indexes()
        .some(([fields, options]) => fields.eventKey === 1 && options.unique));
});
