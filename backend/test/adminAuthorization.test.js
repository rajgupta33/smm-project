const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-jwt-secret-with-sufficient-length';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/not-used-by-unit-tests';
process.env.API_URL = 'https://provider.invalid';
process.env.API_KEY = 'test-provider-key';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.CASHFREE_APP_ID = 'test-cashfree-app';
process.env.CASHFREE_SECRET_KEY = 'test-cashfree-secret';
process.env.CASHFREE_ENV = 'sandbox';
process.env.CASHFREE_API_VERSION = '2025-01-01';
process.env.CASHFREE_RETURN_URL = 'http://localhost:5173/payments/return?order_id={order_id}';
process.env.CASHFREE_NOTIFY_URL = 'https://example.invalid/api/webhooks/cashfree';
process.env.CASHFREE_DEFAULT_CUSTOMER_PHONE = '9999999999';

const User = require('../models/User');
const { createApp } = require('../index');

const adminRoutes = [
    ['GET', '/api/admin/analytics/overview'],
    ['POST', '/api/admin/createUser'],
    ['POST', '/api/admin/getUser'],
    ['PUT', '/api/admin/addBalance'],
    ['POST', '/api/admin/changeUserPassword'],
    ['POST', '/api/admin/createService'],
    ['PUT', '/api/admin/updateService'],
    ['POST', '/api/admin/addService'],
    ['POST', '/api/admin/deleteService'],
    ['GET', '/api/admin/getCustomServices'],
    ['POST', '/api/admin/deleteCustomServices'],
    ['GET', '/api/admin/getServices'],
    ['GET', '/api/admin/pricingSettings'],
    ['PUT', '/api/admin/pricingSettings'],
    ['POST', '/api/admin/pricingSettings/preview'],
    ['GET', '/api/admin/pricingSettings/history'],
    ['GET', '/api/admin/catalogueServices'],
    ['PUT', '/api/admin/catalogueServices/507f1f77bcf86cd799439011'],
    ['GET', '/api/admin/providers'],
    ['POST', '/api/admin/providers'],
    ['PATCH', '/api/admin/providers/507f1f77bcf86cd799439011'],
    ['GET', '/api/admin/providerOffers'],
    ['POST', '/api/admin/providerSync/report'],
    ['GET', '/api/admin/providerSync/runs'],
    ['GET', '/api/admin/providerSync/runs/507f1f77bcf86cd799439011'],
    ['POST', '/api/admin/providerSync/runs/507f1f77bcf86cd799439011/apply'],
    ['GET', '/api/admin/operations/jobDispatches'],
    ['GET', '/api/admin/operations/diagnostics'],
    ['GET', '/api/admin/operations/reconciliationOrders'],
    ['POST', '/api/admin/operations/reconciliationOrders/507f1f77bcf86cd799439011/resolve'],
    ['GET', '/api/admin/payments'],
    ['POST', '/api/admin/payments/507f1f77bcf86cd799439011/reconcile'],
    ['GET', '/api/admin/refills'],
    ['POST', '/api/admin/refills/507f1f77bcf86cd799439011/poll'],
    ['GET', '/api/admin/tickets'],
    ['GET', '/api/admin/tickets/TKT-123'],
    ['POST', '/api/admin/tickets/TKT-123/messages'],
    ['PATCH', '/api/admin/tickets/TKT-123'],
    ['GET', '/api/admin/manualTasks'],
    ['POST', '/api/admin/manualTasks/507f1f77bcf86cd799439011/assign'],
    ['PUT', '/api/admin/manualTasks/507f1f77bcf86cd799439011'],
];

let baseUrl;
let server;
let originalFindOne;

before(async () => {
    originalFindOne = User.findOne;
    User.findOne = async () => ({
        _id: '507f1f77bcf86cd799439011',
        userId: 'normal-user',
        role: 'user',
    });

    const app = createApp({ connect: async () => {} });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    User.findOne = originalFindOne;
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test('every admin route rejects a normal user even when the old JWT claims admin', async () => {
    const token = jwt.sign(
        { id: 'normal-user', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );

    for (const [method, path] of adminRoutes) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                cookie: `auth_token=${token}`,
                ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
            },
            ...(method === 'GET' ? {} : { body: '{}' }),
        });

        assert.equal(response.status, 403, `${method} ${path} must return 403`);
        assert.deepEqual(await response.json(), { message: 'Admin access required' });
    }
});

test('admin routes reject requests without an authentication cookie', async () => {
    const response = await fetch(`${baseUrl}/api/admin/getCustomServices`);
    assert.equal(response.status, 401);
});

test('Cashfree webhook route requires a valid signature instead of a user cookie', async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/cashfree`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-webhook-signature': 'invalid',
            'x-webhook-timestamp': String(Date.now()),
        },
        body: '{}',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_SIGNATURE');
});
