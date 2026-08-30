const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveOrderPricing, toCustomerQuote } = require('../services/orderPricingResolver');

function query(value) {
    return {
        session() { return Promise.resolve(value); },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function baseRequest(overrides = {}) {
    return {
        serviceId: 'svc-1',
        quantity: 1000,
        runs: 1,
        totalQuantity: 1000,
        target: 'https://example.com/post',
        ...overrides,
    };
}

function deps({
    service = { serviceId: 'svc-1', rate: 100, catalogueServiceId: 'cat-1' },
    catalogue = { _id: 'cat-1', active: true, visibility: 'PUBLIC', fulfilmentType: 'AUTOMATIC' },
    offer = { _id: 'offer-1', providerServiceId: '900', costRateMinor: 5000, pricingUnit: 1000 },
    snapshot,
} = {}) {
    const calls = { priced: [], routed: [] };
    return {
        calls,
        overrides: {
            Service: { findOne: () => query(service) },
            CatalogueService: { findById: () => query(catalogue) },
            validateServiceForUser: () => ({ providerServiceId: '900' }),
            selectManualPriorityOffer: async (input) => {
                calls.routed.push(input);
                return { offer };
            },
            priceRoutedService: async (svc, routedOffer, quantity, options) => {
                calls.priced.push({ svc, routedOffer, quantity, options });
                return snapshot || {
                    providerCostRateMinor: 5000,
                    sellingRateMinor: 6000,
                    markupBps: 2000,
                    pricingUnit: 1000,
                    quantity,
                    providerCostTotalMinor: 5000,
                    sellingTotalMinor: 6000,
                    grossSpreadMinor: 1000,
                    currency: 'INR',
                    pricingVersion: 3,
                    pricedAt: new Date('2026-08-30T00:00:00Z'),
                };
            },
        },
    };
}

test('quote and order placement resolve the same price from one code path', async () => {
    const request = baseRequest();
    const quoteDeps = deps();
    const placeDeps = deps();

    const quoted = await resolveOrderPricing({ validatedRequest: request, user: {} }, quoteDeps.overrides);
    const placed = await resolveOrderPricing(
        { validatedRequest: request, user: {}, session: {} },
        placeDeps.overrides
    );

    assert.equal(quoted.pricingSnapshot.sellingTotalMinor, placed.pricingSnapshot.sellingTotalMinor);
    assert.equal(quoted.pricingSnapshot.sellingRateMinor, placed.pricingSnapshot.sellingRateMinor);
    assert.equal(quoted.providerServiceId, placed.providerServiceId);
    // Both routed using the per-run quantity and priced using the total quantity.
    assert.equal(quoteDeps.calls.routed[0].quantity, 1000);
    assert.equal(quoteDeps.calls.priced[0].quantity, 1000);
});

test('routing uses per-run quantity while pricing uses total quantity for drip-feed', async () => {
    const request = baseRequest({ quantity: 500, runs: 4, totalQuantity: 2000 });
    const context = deps();
    await resolveOrderPricing({ validatedRequest: request, user: {} }, context.overrides);
    assert.equal(context.calls.routed[0].quantity, 500);
    assert.equal(context.calls.priced[0].quantity, 2000);
});

test('the customer quote never exposes provider cost, spread, or provider identity', () => {
    const snapshot = {
        providerCostRateMinor: 5000,
        sellingRateMinor: 6000,
        markupBps: 2000,
        pricingUnit: 1000,
        providerCostTotalMinor: 5000,
        sellingTotalMinor: 6000,
        grossSpreadMinor: 1000,
        currency: 'INR',
        pricingVersion: 3,
        pricedAt: new Date('2026-08-30T00:00:00Z'),
    };
    const quote = toCustomerQuote(snapshot, baseRequest());
    const serialized = JSON.stringify(quote);

    assert.equal(quote.totalMinor, 6000);
    assert.equal(quote.sellingRateMinor, 6000);
    assert.equal(quote.currency, 'INR');
    for (const leaked of [
        'providerCostRateMinor', 'providerCostTotalMinor', 'grossSpreadMinor',
        'markupBps', 'pricingVersion', 'providerServiceId',
    ]) {
        assert.equal(serialized.includes(leaked), false, `${leaked} must not reach the browser`);
    }
});

test('an unavailable or hidden catalogue service cannot be quoted or ordered', async () => {
    for (const catalogue of [
        { _id: 'cat-1', active: false, visibility: 'PUBLIC', fulfilmentType: 'AUTOMATIC' },
        { _id: 'cat-1', active: true, visibility: 'HIDDEN', fulfilmentType: 'AUTOMATIC' },
    ]) {
        const context = deps({ catalogue });
        await assert.rejects(
            () => resolveOrderPricing({ validatedRequest: baseRequest(), user: {} }, context.overrides),
            (error) => error.code === 'SERVICE_UNAVAILABLE' && error.statusCode === 400
        );
    }
});

test('an unknown service is rejected before any routing or pricing occurs', async () => {
    const context = deps({ service: null });
    await assert.rejects(
        () => resolveOrderPricing({ validatedRequest: baseRequest(), user: {} }, context.overrides),
        (error) => error.code === 'INVALID_SERVICE'
    );
    assert.equal(context.calls.routed.length, 0);
    assert.equal(context.calls.priced.length, 0);
});

test('manual services reject drip-feed and skip provider routing', async () => {
    const manualCatalogue = {
        _id: 'cat-1', active: true, visibility: 'PUBLIC', fulfilmentType: 'MANUAL',
    };
    const dripContext = deps({ catalogue: manualCatalogue });
    await assert.rejects(
        () => resolveOrderPricing(
            { validatedRequest: baseRequest({ runs: 3, totalQuantity: 3000 }), user: {} },
            dripContext.overrides
        ),
        (error) => error.code === 'DRIP_FEED_NOT_SUPPORTED'
    );

    const singleContext = deps({ catalogue: manualCatalogue });
    const result = await resolveOrderPricing(
        { validatedRequest: baseRequest(), user: {} },
        singleContext.overrides
    );
    assert.equal(result.isManual, true);
    assert.equal(result.providerOffer, null);
    assert.equal(singleContext.calls.routed.length, 0);
});

test('a drip-feed order worth less than one paise per run is rejected', async () => {
    const context = deps({
        snapshot: {
            sellingRateMinor: 1, pricingUnit: 1000, quantity: 300,
            sellingTotalMinor: 2, providerCostRateMinor: 1, providerCostTotalMinor: 1,
            grossSpreadMinor: 1, markupBps: 0, currency: 'INR', pricingVersion: 1,
            pricedAt: new Date(),
        },
    });
    await assert.rejects(
        () => resolveOrderPricing(
            { validatedRequest: baseRequest({ quantity: 100, runs: 3, totalQuantity: 300 }), user: {} },
            context.overrides
        ),
        (error) => error.code === 'DRIP_FEED_VALUE_TOO_SMALL'
    );
});
