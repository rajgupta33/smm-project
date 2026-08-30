const assert = require('node:assert/strict');
const test = require('node:test');

process.env.MAX_MARKUP_BPS = '100000';

const {
    PricingError,
    calculateOrderTotal,
    calculateSellingRate,
    createPriceSnapshot,
    getEffectiveMarkup,
    majorToMinor,
    priceRoutedService,
    toCustomerService,
    validateMarkupBps,
} = require('../services/pricingService');
const AuditLog = require('../models/AuditLog');
const Order = require('../models/Order');
const PricingSettings = require('../models/PricingSettings');
const Service = require('../models/Service');

test('converts major currency rates to integer minor units', () => {
    assert.equal(majorToMinor(100), 10000);
    assert.equal(majorToMinor('12.34'), 1234);
    assert.equal(majorToMinor(0.01), 1);
});

test('calculates representative markup percentages in basis points', () => {
    const cases = [
        [0, 10000],
        [100, 10100],
        [1000, 11000],
        [2500, 12500],
        [3750, 13750],
        [10000, 20000],
    ];
    for (const [markupBps, expected] of cases) {
        assert.equal(calculateSellingRate(10000, markupBps), expected);
    }
});

test('rounds fractional paise upward so configured margin is not lost', () => {
    assert.equal(calculateSellingRate(1, 1), 2);
    assert.equal(calculateOrderTotal(1, 1, 1000), 1);
    assert.equal(calculateOrderTotal(12500, 5000, 1000), 62500);
});

test('uses a service override ahead of the global markup', () => {
    const settings = { globalMarkupBps: 2500, minimumMarginBps: 0 };
    assert.equal(getEffectiveMarkup({ markupOverrideBps: 5000 }, settings), 5000);
    assert.equal(getEffectiveMarkup({ markupOverrideBps: null }, settings), 2500);
});

test('customer service projection exposes selling price but no provider economics', () => {
    const customerService = toCustomerService(
        {
            serviceId: 'local-1',
            service: 'provider-99',
            internalName: 'provider mapping',
            name: 'Followers',
            rate: 100,
            markupOverrideBps: 2500,
        },
        { globalMarkupBps: 1000, minimumMarginBps: 0, currency: 'INR', pricingUnit: 1000 }
    );
    assert.equal(customerService.rateMinor, 12500);
    assert.equal(customerService.rate, 125);
    assert.equal(customerService.service, undefined);
    assert.equal(customerService.internalName, undefined);
    assert.equal(customerService.markupOverrideBps, undefined);
});

test('rejects invalid, excessive, and below-minimum markups', () => {
    for (const invalid of [-1, 1.5, 100001]) {
        assert.throws(() => validateMarkupBps(invalid), PricingError);
    }
    assert.throws(
        () => getEffectiveMarkup(
            { markupOverrideBps: 1000 },
            { globalMarkupBps: 2500, minimumMarginBps: 1500 }
        ),
        (error) => error.code === 'MARKUP_BELOW_MINIMUM'
    );
});

test('rejects calculations outside the safe integer range', () => {
    assert.throws(
        () => calculateOrderTotal(Number.MAX_SAFE_INTEGER, 2, 1000),
        (error) => error.code === 'PRICE_TOO_LARGE'
    );
});

test('order snapshots preserve the price and version used at order time', () => {
    const service = { rate: 100, markupOverrideBps: null };
    const firstSettings = {
        globalMarkupBps: 2500,
        minimumMarginBps: 0,
        pricingUnit: 1000,
        currency: 'INR',
        version: 1,
    };
    const first = createPriceSnapshot({ service, quantity: 5000, settings: firstSettings });
    const second = createPriceSnapshot({
        service,
        quantity: 5000,
        settings: { ...firstSettings, globalMarkupBps: 3000, version: 2 },
    });

    assert.equal(first.providerCostTotalMinor, 50000);
    assert.equal(first.sellingTotalMinor, 62500);
    assert.equal(first.grossSpreadMinor, 12500);
    assert.equal(first.pricingVersion, 1);
    assert.equal(second.sellingTotalMinor, 65000);
    assert.equal(first.sellingTotalMinor, 62500);
});

test('manual routing applies markup to the selected provider offer cost', async () => {
    const snapshot = await priceRoutedService(
        { rate: 100, markupOverrideBps: null },
        { costRateMinor: 9000, pricingUnit: 1000 },
        5000,
        { settings: { globalMarkupBps: 2500, minimumMarginBps: 0, pricingUnit: 1000, currency: 'INR', version: 1 } }
    );
    assert.equal(snapshot.sellingRateMinor, 11250);
    assert.equal(snapshot.sellingTotalMinor, 56250);
    assert.equal(snapshot.providerCostRateMinor, 9000);
    assert.equal(snapshot.providerCostTotalMinor, 45000);
    assert.equal(snapshot.grossSpreadMinor, 11250);

    const example = await priceRoutedService(
        { rate: 1, markupOverrideBps: null },
        { costRateMinor: 10000, pricingUnit: 1000 },
        1000,
        { settings: { globalMarkupBps: 2500, minimumMarginBps: 0, pricingUnit: 1000, currency: 'INR', version: 1 } }
    );
    assert.equal(example.providerCostRateMinor, 10000);
    assert.equal(example.sellingRateMinor, 12500);
    assert.equal(example.sellingTotalMinor, 12500);
});

test('pricing models declare singleton and audit indexes plus immutable snapshots', () => {
    assert.equal(PricingSettings.schema.path('key').options.unique, true);
    assert.equal(Service.schema.path('markupOverrideBps').options.default, null);
    assert.equal(Order.schema.path('pricingSnapshot').options.immutable, true);

    const indexes = AuditLog.schema.indexes();
    assert.ok(indexes.some(([keys]) => keys.action === 1 && keys.createdAt === -1));
    assert.ok(indexes.some(([keys]) => keys.actorId === 1 && keys.createdAt === -1));
});
