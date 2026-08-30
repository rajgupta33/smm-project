const assert = require('node:assert/strict');
const test = require('node:test');

const { getJwtSecret } = require('../middelwares/auth');
const { getRuntimeConfig } = require('../config/runtimeConfig');

test('JWT secret has no source-code fallback', () => {
    const originalSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    try {
        assert.throws(
            () => getJwtSecret(),
            /JWT_SECRET environment variable is required/
        );
    } finally {
        if (originalSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = originalSecret;
        }
    }
});

function validEnvironment(overrides = {}) {
    return {
        NODE_ENV: 'production',
        MONGO_URI: 'mongodb://localhost:27017/test',
        JWT_SECRET: 'a-secure-test-secret-that-is-long-enough',
        API_URL: 'https://provider.example/api',
        API_KEY: 'provider-key',
        REDIS_URL: 'rediss://queue.example:6380',
        CASHFREE_APP_ID: 'cashfree-app-id',
        CASHFREE_SECRET_KEY: 'cashfree-secret-key',
        CASHFREE_ENV: 'production',
        CASHFREE_API_VERSION: '2025-01-01',
        CASHFREE_RETURN_URL: 'https://app.example/payments/return?order_id={order_id}',
        CASHFREE_NOTIFY_URL: 'https://api.example/api/webhooks/cashfree',
        CASHFREE_DEFAULT_CUSTOMER_PHONE: '9999999999',
        ALLOWED_ORIGINS: 'https://app.example,https://admin.example',
        COOKIE_SECURE: 'true',
        COOKIE_SAME_SITE: 'none',
        ...overrides,
    };
}

test('runtime configuration requires every secret and endpoint', () => {
    for (const name of [
        'MONGO_URI', 'JWT_SECRET', 'API_URL', 'API_KEY', 'REDIS_URL',
        'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY',
        'CASHFREE_ENV', 'CASHFREE_API_VERSION', 'CASHFREE_RETURN_URL',
        'CASHFREE_NOTIFY_URL', 'CASHFREE_DEFAULT_CUSTOMER_PHONE',
    ]) {
        const environment = validEnvironment();
        delete environment[name];
        assert.throws(() => getRuntimeConfig(environment), new RegExp(name));
    }
});

test('production configuration requires explicit origins and safe cookie policy', () => {
    assert.throws(
        () => getRuntimeConfig(validEnvironment({ ALLOWED_ORIGINS: '' })),
        /ALLOWED_ORIGINS is required/
    );
    assert.throws(
        () => getRuntimeConfig(validEnvironment({ COOKIE_SECURE: 'false' })),
        /SameSite=None/
    );
});

test('runtime configuration parses allowed origins and cookie options', () => {
    const config = getRuntimeConfig(validEnvironment());
    assert.deepEqual(config.allowedOrigins, ['https://app.example', 'https://admin.example']);
    assert.equal(config.cookie.sameSite, 'none');
    assert.equal(config.cookie.secure, true);
    assert.equal(config.redisUrl, 'rediss://queue.example:6380');
    assert.equal(config.bullmqPrefix, 'smm');
    assert.deepEqual(config.refill, {
        defaultGuaranteeDays: 30,
        cooldownHours: 24,
        statusPollMinutes: 5,
    });
});

test('runtime configuration rejects invalid refill policy intervals', () => {
    assert.throws(
        () => getRuntimeConfig(validEnvironment({ REFILL_COOLDOWN_HOURS: '0' })),
        /REFILL_COOLDOWN_HOURS must be a positive integer/
    );
});

test('runtime configuration rejects non-Redis queue URLs', () => {
    assert.throws(
        () => getRuntimeConfig(validEnvironment({ REDIS_URL: 'https://queue.example' })),
        /REDIS_URL must use redis or rediss/
    );
});

test('production Cashfree callback URLs require HTTPS', () => {
    assert.throws(
        () => getRuntimeConfig(validEnvironment({ CASHFREE_NOTIFY_URL: 'http://api.example/webhook' })),
        /must use https/
    );
});

test('Cashfree API version is pinned to the integration version', () => {
    assert.throws(
        () => getRuntimeConfig(validEnvironment({ CASHFREE_API_VERSION: '2026-01-01' })),
        /must be 2025-01-01/
    );
});
