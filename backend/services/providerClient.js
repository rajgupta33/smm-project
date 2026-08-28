const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SNAPSHOT_CHARACTERS = 10000;
const REDACTED_KEYS = /^(key|api[_-]?key|token|secret|authorization)$/i;

function getTimeoutMs(value = process.env.PROVIDER_TIMEOUT_MS) {
    const configured = Number(value || DEFAULT_TIMEOUT_MS);
    return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function redact(value, depth = 0) {
    if (depth > 5) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).slice(0, 100).map(([key, child]) => [
                key,
                REDACTED_KEYS.test(key) ? '[redacted]' : redact(child, depth + 1),
            ])
        );
    }
    return value;
}

function responseSnapshot(data) {
    const sanitized = redact(data);
    const serialized = JSON.stringify(sanitized);
    if (serialized === undefined) return null;
    if (serialized.length <= MAX_SNAPSHOT_CHARACTERS) return sanitized;
    return { truncated: true, preview: serialized.slice(0, MAX_SNAPSHOT_CHARACTERS) };
}

function explicitProviderError(data) {
    if (!data || typeof data !== 'object') return null;
    const message = data.error || data.message;
    return typeof message === 'string' && message.trim() ? message.trim() : null;
}

function classifyResponse(response) {
    const data = response?.data;
    const providerOrderId = data?.order;
    if (providerOrderId !== undefined && providerOrderId !== null && String(providerOrderId).trim()) {
        return {
            classification: 'ACCEPTED',
            providerOrderId: String(providerOrderId).trim(),
            httpStatus: response.status || 200,
            responseSnapshot: responseSnapshot(data),
        };
    }

    const providerError = explicitProviderError(data);
    if (providerError) {
        return {
            classification: 'DEFINITIVE_REJECTION',
            failureKind: 'PROVIDER_REJECTION',
            httpStatus: response?.status || 200,
            responseSnapshot: responseSnapshot(data),
            errorMessage: providerError,
        };
    }

    return {
        classification: 'AMBIGUOUS',
        failureKind: 'MALFORMED_RESPONSE',
        httpStatus: response?.status || null,
        responseSnapshot: responseSnapshot(data),
        errorMessage: 'Provider response did not contain an order identifier or explicit rejection',
    };
}

function classifyError(error) {
    const httpStatus = error.response?.status || null;
    const snapshot = error.response ? responseSnapshot(error.response.data) : null;
    const providerError = explicitProviderError(error.response?.data);

    if (httpStatus && httpStatus >= 400 && httpStatus < 500 && providerError) {
        return {
            classification: 'DEFINITIVE_REJECTION',
            failureKind: 'PROVIDER_REJECTION',
            httpStatus,
            responseSnapshot: snapshot,
            errorMessage: providerError,
        };
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return {
            classification: 'AMBIGUOUS',
            failureKind: 'TIMEOUT',
            httpStatus,
            responseSnapshot: snapshot,
            errorMessage: 'Provider request timed out',
        };
    }
    return {
        classification: 'AMBIGUOUS',
        failureKind: httpStatus >= 500 ? 'HTTP_5XX' : 'TRANSPORT',
        httpStatus,
        responseSnapshot: snapshot,
        errorMessage: httpStatus >= 500
            ? 'Provider returned a server error'
            : 'Provider request outcome is unknown',
    };
}

function providerConfig(overrides = {}) {
    return {
        apiUrl: overrides.apiUrl || process.env.API_URL,
        apiKey: overrides.apiKey || process.env.API_KEY,
        timeoutMs: getTimeoutMs(overrides.timeoutMs),
    };
}

async function submitOrder({ providerServiceId, target, quantity }, connection) {
    const { apiUrl, apiKey, timeoutMs } = providerConfig(connection);
    try {
        const response = await axios.post(apiUrl, null, {
            params: {
                key: apiKey,
                action: 'add',
                service: providerServiceId,
                link: target,
                quantity,
            },
            timeout: timeoutMs,
        });
        return classifyResponse(response);
    } catch (error) {
        return classifyError(error);
    }
}

async function getOrderStatus(providerOrderId, connection) {
    const { apiUrl, apiKey, timeoutMs } = providerConfig(connection);
    return axios.post(apiUrl, null, {
        params: { key: apiKey, action: 'status', order: providerOrderId },
        timeout: timeoutMs,
    });
}

async function requestRefill(providerOrderId, connection) {
    const { apiUrl, apiKey, timeoutMs } = providerConfig(connection);
    return axios.post(apiUrl, null, {
        params: { key: apiKey, action: 'refill', order: providerOrderId },
        timeout: timeoutMs,
    });
}

async function getRefillStatus(refillId, connection) {
    const { apiUrl, apiKey, timeoutMs } = providerConfig(connection);
    return axios.get(apiUrl, {
        params: { key: apiKey, action: 'refill_status', refill: refillId },
        timeout: timeoutMs,
    });
}

async function listServices(connection) {
    const { apiUrl, apiKey, timeoutMs } = providerConfig(connection);
    return axios.post(apiUrl, new URLSearchParams({
        key: apiKey,
        action: 'services',
    }), { timeout: timeoutMs });
}

module.exports = {
    classifyError,
    classifyResponse,
    getOrderStatus,
    getRefillStatus,
    listServices,
    requestRefill,
    responseSnapshot,
    submitOrder,
};
