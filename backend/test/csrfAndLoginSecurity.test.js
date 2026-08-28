const assert = require('node:assert/strict');
const test = require('node:test');
const { csrfProtection } = require('../middelwares/csrf');
const {
    auditLogin,
    checkLoginLimit,
    clearLoginFailures,
    recordLoginFailure,
} = require('../services/loginSecurityService');
const AuditLog = require('../models/AuditLog');

function fakeRedis() {
    const store = new Map();
    return {
        async get(key) {
            const entry = store.get(key);
            if (!entry) return null;
            if (entry.expiresAt && entry.expiresAt <= Date.now()) { store.delete(key); return null; }
            return String(entry.value);
        },
        async incr(key) {
            const current = Number((await this.get(key)) || 0) + 1;
            const entry = store.get(key) || {};
            store.set(key, { ...entry, value: current });
            return current;
        },
        async pexpire(key, ms) {
            const entry = store.get(key);
            if (entry) store.set(key, { ...entry, expiresAt: Date.now() + ms });
        },
        async pttl(key) {
            const entry = store.get(key);
            if (!entry?.expiresAt) return -1;
            return Math.max(entry.expiresAt - Date.now(), 0);
        },
        async del(key) { store.delete(key); },
    };
}

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test('CSRF middleware permits safe methods and matching double-submit tokens', () => {
    let nextCalls = 0;
    csrfProtection({ method: 'GET' }, response(), () => { nextCalls += 1; });
    csrfProtection({
        method: 'POST', cookies: { csrf_token: 'same-token' }, get: () => 'same-token',
    }, response(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 2);
});

test('CSRF middleware rejects missing and mismatched tokens', () => {
    for (const request of [
        { method: 'POST', cookies: {}, get: () => undefined },
        { method: 'PUT', cookies: { csrf_token: 'one' }, get: () => 'two' },
    ]) {
        const res = response();
        csrfProtection(request, res, () => assert.fail('next must not be called'));
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, 'CSRF_INVALID');
    }
});

test('login limiter blocks the sixth failed attempt and clears after success', async () => {
    const redis = fakeRedis();
    const overrides = { redis, keyPrefix: 'test:login-attempts:' };
    const req = { ip: '203.0.113.10', socket: {}, get: () => undefined };
    let result;
    for (let count = 0; count < 5; count += 1) {
        result = await checkLoginLimit(req, 'customer', overrides);
        assert.equal(result.allowed, true);
        await recordLoginFailure(result.key, overrides);
    }
    result = await checkLoginLimit(req, 'customer', overrides);
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterMs > 0);
    await clearLoginFailures(result.key, overrides);
    assert.equal((await checkLoginLimit(req, 'customer', overrides)).allowed, true);
});

test('login limiter is shared across concurrent requests by IP and user, not per-process state', async () => {
    const redis = fakeRedis();
    const overrides = { redis, keyPrefix: 'test:login-attempts:' };
    const reqA = { ip: '203.0.113.20', socket: {}, get: () => undefined };
    const reqB = { ip: '203.0.113.20', socket: {}, get: () => undefined };

    const first = await checkLoginLimit(reqA, 'shared-user', overrides);
    await recordLoginFailure(first.key, overrides);
    const second = await checkLoginLimit(reqB, 'shared-user', overrides);
    assert.equal(second.key, first.key);

    const different = await checkLoginLimit(reqA, 'other-user', overrides);
    assert.notEqual(different.key, first.key);
});

test('login limiter fails open when Redis is unreachable', async () => {
    const brokenRedis = {
        async get() { throw new Error('connection refused'); },
        async incr() { throw new Error('connection refused'); },
        async pexpire() { throw new Error('connection refused'); },
        async pttl() { throw new Error('connection refused'); },
        async del() { throw new Error('connection refused'); },
    };
    const overrides = { redis: brokenRedis, keyPrefix: 'test:login-attempts:' };
    const req = { ip: '203.0.113.30', socket: {}, get: () => undefined };
    const result = await checkLoginLimit(req, 'customer', overrides);
    assert.equal(result.allowed, true);
    // Must not throw even though the underlying store is down.
    await recordLoginFailure(result.key, overrides);
    await clearLoginFailures(result.key, overrides);
});

test('authentication outcomes create security audit records', async () => {
    const originalCreate = AuditLog.create;
    let recorded;
    AuditLog.create = async (entry) => { recorded = entry; };
    try {
        await auditLogin(
            { ip: '203.0.113.20', socket: {}, get: (name) => name === 'User-Agent' ? 'test-agent' : undefined },
            'AUTH_LOGIN_FAILED',
            'customer'
        );
        assert.equal(recorded.action, 'AUTH_LOGIN_FAILED');
        assert.equal(recorded.targetId, 'customer');
        assert.equal(recorded.metadata.ip, '203.0.113.20');
    } finally {
        AuditLog.create = originalCreate;
    }
});
