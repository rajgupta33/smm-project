function required(env, name) {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name} environment variable is required`);
    }
    return value.trim();
}

function parseUrl(value, name, originOnly = false) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${name} must use http or https`);
    }
    return originOnly ? parsed.origin : parsed.toString();
}

function parseRedisUrl(value) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('REDIS_URL must be a valid URL'); }
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
        throw new Error('REDIS_URL must use redis or rediss');
    }
    return parsed.toString();
}

function positiveIntegerEnv(env, name, fallback) {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

function parseBoolean(value, fallback) {
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error('Boolean environment values must be true or false');
}

function parseTrustProxy(value, nodeEnv) {
    if (value === undefined) return nodeEnv === 'production' ? 1 : false;
    if (value === 'true' || value === 'false') return parseBoolean(value);
    const hops = Number(value);
    if (Number.isSafeInteger(hops) && hops >= 0) return hops;
    throw new Error('TRUST_PROXY must be true, false, or a non-negative integer');
}

function getRuntimeConfig(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const jwtSecret = required(env, 'JWT_SECRET');
    if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');

    const configuredOrigins = (env.ALLOWED_ORIGINS || '')
        .split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => parseUrl(origin, 'ALLOWED_ORIGINS', true));
    const allowedOrigins = configuredOrigins.length
        ? [...new Set(configuredOrigins)]
        : nodeEnv === 'production'
            ? (() => { throw new Error('ALLOWED_ORIGINS is required in production'); })()
            : ['http://localhost:3000', 'http://localhost:5173'];

    const cookieSameSite = (env.COOKIE_SAME_SITE || (nodeEnv === 'production' ? 'none' : 'lax')).toLowerCase();
    if (!['lax', 'strict', 'none'].includes(cookieSameSite)) throw new Error('COOKIE_SAME_SITE is invalid');
    const cookieSecure = parseBoolean(env.COOKIE_SECURE, nodeEnv === 'production');
    if (cookieSameSite === 'none' && !cookieSecure) throw new Error('SameSite=None cookies require COOKIE_SECURE=true');

    const mongoUri = required(env, 'MONGO_URI');
    if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) throw new Error('MONGO_URI must be a MongoDB connection string');

    const cashfreeEnvironment = required(env, 'CASHFREE_ENV').toLowerCase();
    if (!['sandbox', 'production'].includes(cashfreeEnvironment)) {
        throw new Error('CASHFREE_ENV must be sandbox or production');
    }
    const cashfreeApiVersion = required(env, 'CASHFREE_API_VERSION');
    if (cashfreeApiVersion !== '2025-01-01') {
        throw new Error('CASHFREE_API_VERSION must be 2025-01-01 for this integration');
    }
    const cashfreeSecretKey = required(env, 'CASHFREE_SECRET_KEY');
    const cashfreeMinTopupMinor = positiveIntegerEnv(env, 'CASHFREE_MIN_TOPUP_MINOR', 10000);
    const cashfreeMaxTopupMinor = positiveIntegerEnv(env, 'CASHFREE_MAX_TOPUP_MINOR', 10000000);
    if (cashfreeMaxTopupMinor < cashfreeMinTopupMinor) {
        throw new Error('CASHFREE_MAX_TOPUP_MINOR must be greater than or equal to the minimum');
    }
    const cashfreeCustomerPhone = required(env, 'CASHFREE_DEFAULT_CUSTOMER_PHONE');
    if (!/^\d{10}$/.test(cashfreeCustomerPhone)) {
        throw new Error('CASHFREE_DEFAULT_CUSTOMER_PHONE must contain 10 digits');
    }
    const cashfreeReturnUrl = required(env, 'CASHFREE_RETURN_URL');
    const parsedCashfreeReturnUrl = parseUrl(cashfreeReturnUrl, 'CASHFREE_RETURN_URL');
    const cashfreeNotifyUrl = parseUrl(required(env, 'CASHFREE_NOTIFY_URL'), 'CASHFREE_NOTIFY_URL');
    if (cashfreeEnvironment === 'production' &&
        (!parsedCashfreeReturnUrl.startsWith('https://') || !cashfreeNotifyUrl.startsWith('https://'))) {
        throw new Error('Production Cashfree return and notify URLs must use https');
    }

    return {
        nodeEnv,
        mongoUri,
        jwtSecret,
        apiUrl: parseUrl(required(env, 'API_URL'), 'API_URL'),
        apiKey: required(env, 'API_KEY'),
        redisUrl: parseRedisUrl(required(env, 'REDIS_URL')),
        bullmqPrefix: env.BULLMQ_PREFIX?.trim() || 'smm',
        cashfree: {
            appId: required(env, 'CASHFREE_APP_ID'),
            secretKey: cashfreeSecretKey,
            webhookSecret: cashfreeSecretKey,
            environment: cashfreeEnvironment,
            apiVersion: cashfreeApiVersion,
            returnUrl: cashfreeReturnUrl,
            notifyUrl: cashfreeNotifyUrl,
            defaultCustomerPhone: cashfreeCustomerPhone,
            minTopupMinor: cashfreeMinTopupMinor,
            maxTopupMinor: cashfreeMaxTopupMinor,
            webhookToleranceMs: positiveIntegerEnv(env, 'CASHFREE_WEBHOOK_TOLERANCE_MS', 300000),
        },
        refill: {
            defaultGuaranteeDays: positiveIntegerEnv(env, 'REFILL_DEFAULT_GUARANTEE_DAYS', 30),
            cooldownHours: positiveIntegerEnv(env, 'REFILL_COOLDOWN_HOURS', 24),
            statusPollMinutes: positiveIntegerEnv(env, 'REFILL_STATUS_POLL_MINUTES', 5),
        },
        orderStatus: {
            pollMinutes: positiveIntegerEnv(env, 'ORDER_STATUS_POLL_MINUTES', 10),
        },
        allowedOrigins,
        trustProxy: parseTrustProxy(env.TRUST_PROXY, nodeEnv),
        cookie: {
            domain: env.COOKIE_DOMAIN?.trim() || undefined,
            sameSite: cookieSameSite,
            secure: cookieSecure,
        },
    };
}

module.exports = { getRuntimeConfig };
