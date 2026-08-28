const assert = require('node:assert/strict');
const test = require('node:test');
const { csrfProtection } = require('../middelwares/csrf');
const {
    auditLogin,
    checkLoginLimit,
    clearLoginFailures,
    recordLoginFailure,
    resetLoginAttempts,
} = require('../services/loginSecurityService');
const AuditLog = require('../models/AuditLog');

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

test('login limiter blocks the sixth failed attempt and clears after success', () => {
    resetLoginAttempts();
    const req = { ip: '203.0.113.10', socket: {}, get: () => undefined };
    let result;
    for (let count = 0; count < 5; count += 1) {
        result = checkLoginLimit(req, 'customer');
        assert.equal(result.allowed, true);
        recordLoginFailure(result.key);
    }
    result = checkLoginLimit(req, 'customer');
    assert.equal(result.allowed, false);
    clearLoginFailures(result.key);
    assert.equal(checkLoginLimit(req, 'customer').allowed, true);
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
