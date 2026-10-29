const providerClient = require('../services/providerClient');
const { assertProviderAdapter } = require('./providerAdapter');

function normalizeProviderService(raw) {
    return {
        providerServiceId: String(raw.service ?? '').trim(),
        name: String(raw.name ?? '').trim(),
        category: String(raw.category ?? '').trim(),
        description: String(raw.description ?? raw.type ?? '').trim(),
        rate: raw.rate,
        min: raw.min,
        max: raw.max,
        supportsRefill: raw.refill === true || String(raw.refill).toLowerCase() === 'true',
        raw,
    };
}

function balanceError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/** Standard SMM API v2 `balance` response: { "balance": "100.84", "currency": "INR" }. */
function parseProviderBalance(data) {
    if (data && typeof data === 'object' && typeof data.error === 'string' && data.error.trim()) {
        throw balanceError(data.error.trim().slice(0, 200), 'PROVIDER_BALANCE_REJECTED');
    }
    const raw = data?.balance;
    const amount = Number(raw);
    if (raw === undefined || raw === null || String(raw).trim() === '' || !Number.isFinite(amount)) {
        throw balanceError('Provider balance response did not contain a numeric balance', 'MALFORMED_BALANCE_RESPONSE');
    }
    const balanceMinor = Math.round(amount * 100);
    if (!Number.isSafeInteger(balanceMinor)) {
        throw balanceError('Provider balance is outside the supported range', 'MALFORMED_BALANCE_RESPONSE');
    }
    const currency = String(data.currency ?? '').trim().toUpperCase();
    return { balanceMinor, currency: currency || null };
}

function createLegacySmmProviderAdapter(connection) {
    return assertProviderAdapter({
        adapterType: 'LEGACY_SMM',

        async getServices() {
            const response = await providerClient.listServices(connection);
            if (!Array.isArray(response.data)) throw new Error('Provider service response must be an array');
            return response.data.map(normalizeProviderService);
        },

        placeOrder(input) {
            return providerClient.submitOrder(input, connection);
        },

        async getOrderStatus(providerOrderId) {
            const response = await providerClient.getOrderStatus(providerOrderId, connection);
            return response.data;
        },

        async requestRefill(providerOrderId) {
            const response = await providerClient.requestRefill(providerOrderId, connection);
            return response.data;
        },

        async getRefillStatus(refillId) {
            const response = await providerClient.getRefillStatus(refillId, connection);
            return response.data;
        },

        async getBalance() {
            const response = await providerClient.getBalance(connection);
            return parseProviderBalance(response.data);
        },
    });
}

const legacySmmProviderAdapter = createLegacySmmProviderAdapter();

module.exports = {
    createLegacySmmProviderAdapter,
    legacySmmProviderAdapter,
    normalizeProviderService,
    parseProviderBalance,
};
