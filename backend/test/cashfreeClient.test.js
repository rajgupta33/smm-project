const assert = require('node:assert/strict');
const test = require('node:test');

const { baseUrl, createCashfreeClient, safeSnapshot } = require('../services/cashfreeClient');

const config = {
    environment: 'sandbox', apiVersion: '2026-01-01',
    appId: 'app-id', secretKey: 'secret-key',
};

test('Cashfree client uses the current sandbox endpoint, API version and idempotency header', async () => {
    let request;
    const client = createCashfreeClient({
        config,
        http: {
            async post(url, body, options) {
                request = { url, body, options };
                return { data: { order_id: body.order_id } };
            },
        },
    });
    await client.createOrder({ body: { order_id: 'pay_1' }, idempotencyKey: 'uuid-key' });
    assert.equal(request.url, 'https://sandbox.cashfree.com/pg/orders');
    assert.equal(request.options.headers['x-api-version'], '2026-01-01');
    assert.equal(request.options.headers['x-client-id'], 'app-id');
    assert.equal(request.options.headers['x-client-secret'], 'secret-key');
    assert.equal(request.options.headers['x-idempotency-key'], 'uuid-key');
    assert.equal(baseUrl('production'), 'https://api.cashfree.com/pg');
});

test('stored Cashfree snapshots never include credentials or payment sessions', () => {
    const snapshot = safeSnapshot({
        order_id: 'pay_1', order_status: 'ACTIVE', payment_session_id: 'secret-session',
        x_client_secret: 'secret-key',
    });
    assert.equal(snapshot.order_id, 'pay_1');
    assert.equal(snapshot.payment_session_id, undefined);
    assert.equal(snapshot.x_client_secret, undefined);
});
