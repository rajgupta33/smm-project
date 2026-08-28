const { randomUUID } = require('crypto');
const AuditLog = require('../models/AuditLog');
const { getProducerConnection } = require('../queues/queueRegistry');
const { getRuntimeConfig } = require('../config/runtimeConfig');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function dependencies(overrides = {}) {
    return {
        redis: overrides.redis || getProducerConnection(),
        keyPrefix: overrides.keyPrefix || `${getRuntimeConfig().bullmqPrefix}:login-attempts:`,
    };
}

function keyFor(req, userId, keyPrefix) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const normalizedUserId = String(userId || '').trim().toLowerCase();
    return `${keyPrefix}${ip}:${normalizedUserId}`;
}

/**
 * Checks whether a login attempt is allowed under the shared, Redis-backed
 * fixed-window limiter. Every API instance and every serverless invocation
 * reads the same counter, so the limit holds regardless of how many
 * processes are handling requests.
 *
 * Fails open: if Redis is unreachable, the attempt is allowed rather than
 * blocking all logins on an infrastructure outage unrelated to credentials.
 * Failed attempts are always written to the audit log regardless of Redis
 * availability, so a Redis outage does not erase the security trail either.
 */
async function checkLoginLimit(req, userId, overrides = {}) {
    const deps = dependencies(overrides);
    const key = keyFor(req, userId, deps.keyPrefix);
    try {
        const count = Number(await deps.redis.get(key)) || 0;
        if (count < MAX_ATTEMPTS) return { allowed: true, key };
        const ttlMs = await deps.redis.pttl(key);
        return { allowed: false, key, retryAfterMs: ttlMs > 0 ? ttlMs : WINDOW_MS };
    } catch (error) {
        console.error('Login rate limiter unavailable, allowing attempt:', error.message);
        return { allowed: true, key };
    }
}

async function recordLoginFailure(key, overrides = {}) {
    const deps = dependencies(overrides);
    try {
        const count = await deps.redis.incr(key);
        if (count === 1) await deps.redis.pexpire(key, WINDOW_MS);
    } catch (error) {
        console.error('Failed to record login failure in rate limiter:', error.message);
    }
}

async function clearLoginFailures(key, overrides = {}) {
    const deps = dependencies(overrides);
    try {
        await deps.redis.del(key);
    } catch (error) {
        console.error('Failed to clear login failures in rate limiter:', error.message);
    }
}

async function auditLogin(req, action, userId, actorId = null) {
    try {
        await AuditLog.create({
            action,
            actorType: actorId ? 'USER' : 'SYSTEM',
            actorId,
            targetType: 'Authentication',
            targetId: String(userId || 'unknown').slice(0, 200),
            requestId: req.get('X-Request-Id')?.slice(0, 200) || randomUUID(),
            metadata: {
                ip: req.ip || req.socket?.remoteAddress || null,
                userAgent: req.get('User-Agent')?.slice(0, 500) || null,
            },
        });
    } catch (error) {
        console.error('Authentication audit write failed:', error.message);
    }
}

module.exports = {
    auditLogin,
    checkLoginLimit,
    clearLoginFailures,
    recordLoginFailure,
};
