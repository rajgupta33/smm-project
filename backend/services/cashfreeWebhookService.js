const { createHash, createHmac, timingSafeEqual } = require('crypto');
const { getRuntimeConfig } = require('../config/runtimeConfig');

class CashfreeWebhookError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'CashfreeWebhookError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function verifyCashfreeWebhook({ rawBody, signature, timestamp, now = Date.now(), config }) {
    const cashfree = config || getRuntimeConfig().cashfree;
    if (!Buffer.isBuffer(rawBody) || !signature || !timestamp) {
        throw new CashfreeWebhookError('Cashfree webhook headers or raw body are missing', 'INVALID_WEBHOOK');
    }
    const timestampMs = Number(timestamp);
    if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > cashfree.webhookToleranceMs) {
        throw new CashfreeWebhookError('Cashfree webhook timestamp is outside the accepted window', 'STALE_WEBHOOK');
    }
    const expected = createHmac('sha256', cashfree.webhookSecret)
        .update(String(timestamp) + rawBody.toString('utf8'))
        .digest();
    let actual;
    try { actual = Buffer.from(signature, 'base64'); } catch {
        throw new CashfreeWebhookError('Cashfree webhook signature is invalid', 'INVALID_SIGNATURE');
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new CashfreeWebhookError('Cashfree webhook signature is invalid', 'INVALID_SIGNATURE');
    }
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch {
        throw new CashfreeWebhookError('Cashfree webhook JSON is invalid', 'INVALID_WEBHOOK_JSON');
    }
    return payload;
}

function webhookEventKey({ idempotencyKey, signature, timestamp, rawBody }) {
    if (typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
        return `cashfree-${idempotencyKey.trim()}`;
    }
    return `cashfree-${createHash('sha256')
        .update(String(timestamp)).update(String(signature)).update(rawBody)
        .digest('hex')}`;
}

module.exports = { CashfreeWebhookError, verifyCashfreeWebhook, webhookEventKey };
