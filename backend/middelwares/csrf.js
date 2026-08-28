const { randomBytes, timingSafeEqual } = require('crypto');

const CSRF_COOKIE = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfCookieOptions(cookieConfig) {
    return {
        httpOnly: false,
        secure: cookieConfig.secure,
        sameSite: cookieConfig.sameSite,
        domain: cookieConfig.domain,
        path: '/',
        maxAge: 60 * 60 * 1000,
    };
}

function issueCsrfToken(req, res) {
    const token = randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions(req.app.locals.runtimeConfig.cookie));
    res.status(200).json({ csrfToken: token });
}

function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.get('X-CSRF-Token');
    if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
        return res.status(403).json({ error: 'CSRF validation failed', code: 'CSRF_INVALID' });
    }
    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerToken);
    if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
        return res.status(403).json({ error: 'CSRF validation failed', code: 'CSRF_INVALID' });
    }
    return next();
}

module.exports = { CSRF_COOKIE, csrfCookieOptions, csrfProtection, issueCsrfToken };
