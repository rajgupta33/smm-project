const assert = require('node:assert/strict');
const test = require('node:test');

process.env.JWT_SECRET ||= 'test-only-jwt-secret-with-sufficient-length';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/not-used';
process.env.API_URL ||= 'https://provider.invalid';
process.env.API_KEY ||= 'provider-key';
process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
process.env.CASHFREE_APP_ID ||= 'cashfree-app';
process.env.CASHFREE_SECRET_KEY ||= 'cashfree-secret';
process.env.CASHFREE_ENV ||= 'sandbox';
process.env.CASHFREE_API_VERSION ||= '2025-01-01';
process.env.CASHFREE_RETURN_URL ||= 'http://localhost:5173/payments/return?order_id={order_id}';
process.env.CASHFREE_NOTIFY_URL ||= 'https://example.invalid/api/webhooks/cashfree';
process.env.CASHFREE_DEFAULT_CUSTOMER_PHONE ||= '9999999999';

const { parseWorkerHeartbeat, WORKER_HEARTBEAT_TTL_SECONDS } = require('../queues/queueRegistry');

test('worker heartbeat reports a fresh timestamp without exposing configuration', () => {
    const now = Date.parse('2026-08-30T12:00:00.000Z');
    const heartbeat = parseWorkerHeartbeat(JSON.stringify({
        workerId: 'worker-1',
        timestamp: new Date(now - 1000).toISOString(),
    }), now);
    assert.deepEqual(heartbeat, {
        healthy: true,
        lastHeartbeatAt: '2026-08-30T11:59:59.000Z',
        ageMs: 1000,
        workerId: 'worker-1',
    });
});

test('worker heartbeat becomes unhealthy after its TTL and rejects malformed values', () => {
    const now = Date.parse('2026-08-30T12:00:00.000Z');
    const stale = parseWorkerHeartbeat(JSON.stringify({
        timestamp: new Date(now - (WORKER_HEARTBEAT_TTL_SECONDS * 1000) - 1).toISOString(),
    }), now);
    assert.equal(stale.healthy, false);
    assert.deepEqual(parseWorkerHeartbeat('not-json', now), {
        healthy: false,
        lastHeartbeatAt: null,
        ageMs: null,
    });
});
