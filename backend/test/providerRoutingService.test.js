const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    chooseManualPriorityOffer,
    isEligibleOffer,
} = require('../services/providerRoutingService');

function offer(providerId, overrides = {}) {
    return {
        _id: `offer-${providerId}`,
        providerId: {
            _id: providerId,
            enabled: true,
            healthStatus: 'HEALTHY',
        },
        providerServiceId: `${providerId}-service`,
        availability: 'AVAILABLE',
        pricingUnit: 1000,
        min: 100,
        max: 10000,
        costRateMinor: 100,
        ...overrides,
    };
}

const catalogue = {
    _id: 'catalogue-1',
    routingStrategy: 'MANUAL_PRIORITY',
    primaryProviderId: 'primary',
    fallbackProviderId: 'fallback',
    pricingUnit: 1000,
};

test('manual priority chooses the primary provider without cheapest-provider automation', () => {
    const primary = offer('primary', { costRateMinor: 500 });
    const fallback = offer('fallback', { costRateMinor: 100 });
    const selected = chooseManualPriorityOffer({ catalogueService: catalogue, offers: [fallback, primary], quantity: 500 });
    assert.equal(selected.offer, primary);
    assert.equal(selected.selectedRole, 'PRIMARY');
});

test('fallback is selected only when primary is ineligible before any provider call', () => {
    const primary = offer('primary', { availability: 'UNAVAILABLE' });
    const fallback = offer('fallback');
    const selected = chooseManualPriorityOffer({ catalogueService: catalogue, offers: [primary, fallback], quantity: 500 });
    assert.equal(selected.offer, fallback);
    assert.equal(selected.selectedRole, 'FALLBACK');
});

test('multiple eligible legacy offers require explicit primary configuration', () => {
    assert.throws(() => chooseManualPriorityOffer({
        catalogueService: { routingStrategy: 'MANUAL_PRIORITY', pricingUnit: 1000 },
        offers: [offer('one'), offer('two')],
        quantity: 500,
    }), (error) => error.code === 'PROVIDER_PRIORITY_REQUIRED');
});

test('disabled, unavailable, out-of-range and wrong-unit offers are ineligible', () => {
    assert.equal(isEligibleOffer(offer('one'), 500), true);
    assert.equal(isEligibleOffer(offer('one', { min: 501 }), 500), false);
    assert.equal(isEligibleOffer(offer('one', { providerId: { _id: 'one', enabled: false } }), 500), false);
    assert.throws(() => chooseManualPriorityOffer({
        catalogueService: catalogue,
        offers: [offer('primary', { pricingUnit: 1 }), offer('fallback', { pricingUnit: 1 })],
        quantity: 500,
    }), (error) => error.code === 'NO_PROVIDER_AVAILABLE');
});

test('automatic routing strategies remain disabled', () => {
    assert.throws(() => chooseManualPriorityOffer({
        catalogueService: { ...catalogue, routingStrategy: 'COST_AWARE' },
        offers: [offer('primary')],
        quantity: 500,
    }), (error) => error.code === 'ROUTING_STRATEGY_NOT_ENABLED');
});
