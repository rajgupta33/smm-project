const PricingSettings = require('../models/PricingSettings');

const DEFAULT_PRICING_UNIT = 1000;
const BASIS_POINT_SCALE = 10000;

class PricingError extends Error {
    constructor(message, code = 'INVALID_PRICING', statusCode = 400) {
        super(message);
        this.name = 'PricingError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function getMaxMarkupBps() {
    const configured = Number(process.env.MAX_MARKUP_BPS || 100000);
    if (!Number.isSafeInteger(configured) || configured < 0) {
        throw new PricingError('MAX_MARKUP_BPS configuration is invalid', 'INVALID_PRICING_CONFIGURATION', 500);
    }
    return configured;
}

function assertNonNegativeSafeInteger(value, fieldName) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new PricingError(`${fieldName} must be a non-negative integer`, 'INVALID_PRICING_VALUE');
    }
}

function validateMarkupBps(markupBps) {
    assertNonNegativeSafeInteger(markupBps, 'markupBps');
    if (markupBps > getMaxMarkupBps()) {
        throw new PricingError(
            `markupBps cannot exceed ${getMaxMarkupBps()}`,
            'MARKUP_ABOVE_LIMIT'
        );
    }
    return markupBps;
}

function majorToMinor(amount, fieldName = 'provider rate') {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
        throw new PricingError(`${fieldName} is invalid`, 'INVALID_PROVIDER_RATE');
    }
    const minor = Math.round((numericAmount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(minor)) {
        throw new PricingError(`${fieldName} is too large`, 'INVALID_PROVIDER_RATE');
    }
    return minor;
}

function safeMultiply(left, right, errorCode = 'PRICE_TOO_LARGE') {
    const product = left * right;
    if (!Number.isSafeInteger(product)) {
        throw new PricingError('Calculated price exceeds the supported range', errorCode);
    }
    return product;
}

function ceilDivide(numerator, denominator) {
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
        throw new PricingError('Pricing division inputs are invalid', 'INVALID_PRICING_CONFIGURATION');
    }
    return Math.ceil(numerator / denominator);
}

function calculateSellingRate(providerCostRateMinor, markupBps) {
    assertNonNegativeSafeInteger(providerCostRateMinor, 'providerCostRateMinor');
    validateMarkupBps(markupBps);
    return ceilDivide(
        safeMultiply(providerCostRateMinor, BASIS_POINT_SCALE + markupBps),
        BASIS_POINT_SCALE
    );
}

function calculateOrderTotal(rateMinor, quantity, pricingUnit = DEFAULT_PRICING_UNIT) {
    assertNonNegativeSafeInteger(rateMinor, 'rateMinor');
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new PricingError('quantity must be a positive integer', 'INVALID_QUANTITY');
    }
    if (!Number.isSafeInteger(pricingUnit) || pricingUnit <= 0) {
        throw new PricingError('pricingUnit must be a positive integer', 'INVALID_PRICING_CONFIGURATION');
    }
    return ceilDivide(safeMultiply(rateMinor, quantity), pricingUnit);
}

function getEffectiveMarkup(service, settings) {
    const override = service.markupOverrideBps;
    const markupBps = override === null || override === undefined
        ? settings.globalMarkupBps
        : override;
    validateMarkupBps(markupBps);
    const minimumMarginBps = settings.minimumMarginBps || 0;
    validateMarkupBps(minimumMarginBps);
    if (markupBps < minimumMarginBps) {
        throw new PricingError(
            'Effective markup is below the configured minimum margin',
            'MARKUP_BELOW_MINIMUM'
        );
    }
    return markupBps;
}

function createPriceSnapshot({
    service,
    quantity,
    settings,
    pricedAt = new Date(),
}) {
    const providerCostRateMinor = majorToMinor(service.rate);
    const markupBps = getEffectiveMarkup(service, settings);
    const pricingUnit = settings.pricingUnit || DEFAULT_PRICING_UNIT;
    const sellingRateMinor = calculateSellingRate(providerCostRateMinor, markupBps);
    const providerCostTotalMinor = calculateOrderTotal(providerCostRateMinor, quantity, pricingUnit);
    const sellingTotalMinor = calculateOrderTotal(sellingRateMinor, quantity, pricingUnit);

    return {
        providerCostRateMinor,
        sellingRateMinor,
        markupBps,
        pricingUnit,
        quantity,
        providerCostTotalMinor,
        sellingTotalMinor,
        grossSpreadMinor: sellingTotalMinor - providerCostTotalMinor,
        currency: settings.currency || 'INR',
        pricingVersion: settings.version,
        pricedAt,
    };
}

function toCustomerService(service, settings) {
    const markupBps = getEffectiveMarkup(service, settings);
    const rateMinor = calculateSellingRate(majorToMinor(service.rate), markupBps);
    const publicService = { ...service };
    delete publicService.rate;
    delete publicService.markupOverrideBps;
    delete publicService.service;
    delete publicService.internalName;
    return {
        ...publicService,
        rate: rateMinor / 100,
        rateMinor,
        currency: settings.currency,
        pricingUnit: settings.pricingUnit,
    };
}

async function getPricingSettings({ session } = {}) {
    const query = PricingSettings.findOneAndUpdate(
        { key: 'global' },
        {
            $setOnInsert: {
                globalMarkupBps: 0,
                currency: 'INR',
                pricingUnit: DEFAULT_PRICING_UNIT,
                minimumMarginBps: 0,
                version: 1,
            },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    return query;
}

async function priceService(service, quantity, options = {}) {
    const settings = options.settings || await getPricingSettings({ session: options.session });
    return createPriceSnapshot({ service, quantity, settings, pricedAt: options.pricedAt });
}

async function priceRoutedService(service, offer, quantity, options = {}) {
    const snapshot = await priceService(service, quantity, options);
    if (!offer) return snapshot;
    assertNonNegativeSafeInteger(offer.costRateMinor, 'provider offer costRateMinor');
    const providerCostTotalMinor = calculateOrderTotal(
        offer.costRateMinor,
        quantity,
        offer.pricingUnit
    );
    if (providerCostTotalMinor > snapshot.sellingTotalMinor) {
        throw new PricingError(
            'Selected provider cost exceeds the authoritative customer price',
            'ROUTED_MARGIN_BELOW_ZERO',
            409
        );
    }
    return {
        ...snapshot,
        providerCostRateMinor: offer.costRateMinor,
        providerCostTotalMinor,
        grossSpreadMinor: snapshot.sellingTotalMinor - providerCostTotalMinor,
    };
}

module.exports = {
    BASIS_POINT_SCALE,
    DEFAULT_PRICING_UNIT,
    PricingError,
    calculateOrderTotal,
    calculateSellingRate,
    createPriceSnapshot,
    getEffectiveMarkup,
    getMaxMarkupBps,
    getPricingSettings,
    majorToMinor,
    priceService,
    priceRoutedService,
    toCustomerService,
    validateMarkupBps,
};
