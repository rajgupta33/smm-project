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
    });
}

const legacySmmProviderAdapter = createLegacySmmProviderAdapter();

module.exports = { createLegacySmmProviderAdapter, legacySmmProviderAdapter, normalizeProviderService };
