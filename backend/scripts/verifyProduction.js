require('dotenv').config();

function configuredOrigin() {
    const raw = process.env.API_ORIGIN || process.argv[2];
    if (!raw) throw new Error('Set API_ORIGIN or pass the public API origin as the first argument');
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('Production API origin must use https');
    if (url.pathname !== '/' || url.search || url.hash) {
        throw new Error('API_ORIGIN must be an origin without a path, query, or fragment');
    }
    return url.origin;
}

async function check(origin, path, validate) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`${origin}${path}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
        const body = await response.text();
        let json;
        try { json = JSON.parse(body); } catch { throw new Error(`${path} did not return JSON`); }
        if (response.status !== 200) {
            throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(json)}`);
        }
        if (validate) validate(json);
        console.log(`${path}: HTTP 200 ${JSON.stringify(json)}`);
    } finally {
        clearTimeout(timeout);
    }
}

async function run() {
    const origin = configuredOrigin();
    await check(origin, '/health', (body) => {
        if (body.status !== 'ok') throw new Error('/health response has an unexpected shape');
    });
    await check(origin, '/ready', (body) => {
        if (body.status !== 'ready' || body.checks?.mongo !== true
            || body.checks?.redis?.connected !== true
            || body.checks?.redis?.noEviction !== true
            || body.checks?.worker?.healthy !== true) {
            throw new Error('/ready does not confirm MongoDB, Redis noeviction, and a fresh worker heartbeat');
        }
    });
    console.log('Production smoke checks passed; no authenticated or paid operation was attempted.');
}

if (require.main === module) {
    run().catch((error) => {
        console.error(`Production verification failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { check, configuredOrigin, run };
