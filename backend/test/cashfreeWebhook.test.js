const assert = require('node:assert/strict');
const { createHmac } = require('crypto');
const test = require('node:test');

const { verifyCashfreeWebhook } = require('../services/cashfreeWebhookService');

const config = { webhookSecret: 'unit-test-webhook-secret', webhookToleranceMs: 300000 };

test('Cashfree webhook verification authenticates the exact raw request bytes', () => {
    const timestamp = String(Date.now());
    const rawBody = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"value":1}}');
    const signature = createHmac('sha256', config.webhookSecret)
        .update(timestamp + rawBody.toString('utf8')).digest('base64');
    const payload = verifyCashfreeWebhook({ rawBody, signature, timestamp, config });
    assert.equal(payload.type, 'PAYMENT_SUCCESS_WEBHOOK');
    assert.throws(
        () => verifyCashfreeWebhook({
            rawBody: Buffer.from(rawBody.toString().replace(':1', ':2')),
            signature, timestamp, config,
        }),
        (error) => error.code === 'INVALID_SIGNATURE'
    );
});

test('Cashfree webhook verification rejects invalid signatures and stale timestamps', () => {
    const timestamp = String(Date.now());
    const rawBody = Buffer.from('{}');
    assert.throws(
        () => verifyCashfreeWebhook({ rawBody, signature: 'invalid', timestamp, config }),
        (error) => error.code === 'INVALID_SIGNATURE'
    );
    const staleTimestamp = String(Date.now() - 300001);
    const staleSignature = createHmac('sha256', config.webhookSecret)
        .update(staleTimestamp + rawBody.toString()).digest('base64');
    assert.throws(
        () => verifyCashfreeWebhook({ rawBody, signature: staleSignature, timestamp: staleTimestamp, config }),
        (error) => error.code === 'STALE_WEBHOOK'
    );
});
