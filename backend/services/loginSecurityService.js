const { randomUUID } = require('crypto');
const AuditLog = require('../models/AuditLog');

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function keyFor(req, userId) {
    return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(userId || '').trim().toLowerCase()}`;
}

function checkLoginLimit(req, userId, now = Date.now()) {
    const key = keyFor(req, userId);
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
        attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
        return { allowed: true, key };
    }
    return { allowed: current.count < MAX_ATTEMPTS, key, retryAfterMs: current.resetAt - now };
}

function recordLoginFailure(key) {
    const current = attempts.get(key) || { count: 0, resetAt: Date.now() + WINDOW_MS };
    current.count += 1;
    attempts.set(key, current);
}

function clearLoginFailures(key) { attempts.delete(key); }
function resetLoginAttempts() { attempts.clear(); }

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
    resetLoginAttempts,
};
