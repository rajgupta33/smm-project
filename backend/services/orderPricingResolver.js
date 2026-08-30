const Service = require('../models/Service');
const CatalogueService = require('../models/CatalogueService');
const { validateServiceForUser } = require('./orderValidationService');
const { priceRoutedService } = require('./pricingService');
const { selectManualPriorityOffer } = require('./providerRoutingService');

function dependencies(overrides = {}) {
    return {
        Service: overrides.Service || Service,
        CatalogueService: overrides.CatalogueService || CatalogueService,
        validateServiceForUser: overrides.validateServiceForUser || validateServiceForUser,
        priceRoutedService: overrides.priceRoutedService || priceRoutedService,
        selectManualPriorityOffer: overrides.selectManualPriorityOffer || selectManualPriorityOffer,
    };
}

function withSession(query, session) {
    return session && typeof query?.session === 'function' ? query.session(session) : query;
}

/**
 * Resolves the service, catalogue entry, routed provider offer, and authoritative
 * price for an order request.
 *
 * Both the customer quote endpoint and order placement call this, so the price a
 * customer is shown before paying is produced by the same code path that charges
 * them. Any divergence here would let the catalogue advertise one price while
 * checkout debits another.
 *
 * This performs no wallet mutation and creates no records. Quoting is not
 * authorization: placement re-runs this inside its own transaction.
 */
async function resolveOrderPricing(
    { validatedRequest, user, session = null },
    overrides = {}
) {
    const deps = dependencies(overrides);

    const selectedService = await withSession(
        deps.Service.findOne({ serviceId: validatedRequest.serviceId }),
        session
    );
    if (!selectedService) {
        const error = new Error('Service not found');
        error.statusCode = 400;
        error.code = 'INVALID_SERVICE';
        throw error;
    }

    const catalogueService = selectedService.catalogueServiceId
        ? await withSession(
            deps.CatalogueService.findById(selectedService.catalogueServiceId),
            session
        )
        : null;
    if (catalogueService && (!catalogueService.active || catalogueService.visibility === 'HIDDEN')) {
        const error = new Error('Service is not available');
        error.statusCode = 400;
        error.code = 'SERVICE_UNAVAILABLE';
        throw error;
    }

    const isManual = catalogueService?.fulfilmentType === 'MANUAL';
    const isDripFeed = validatedRequest.runs > 1 && !isManual;
    if (isManual && validatedRequest.runs > 1) {
        const error = new Error('Drip-feed scheduling is not available for manual services');
        error.statusCode = 400;
        error.code = 'DRIP_FEED_NOT_SUPPORTED';
        throw error;
    }

    const validationResult = deps.validateServiceForUser(
        selectedService,
        user,
        validatedRequest.quantity,
        { requireProviderMapping: !isManual }
    );

    let providerServiceId = validationResult.providerServiceId;
    let providerOffer = null;
    if (!isManual && catalogueService) {
        const routing = await deps.selectManualPriorityOffer({
            catalogueService,
            providerServiceId,
            quantity: validatedRequest.quantity,
            session,
        });
        providerOffer = routing.offer;
        providerServiceId = providerOffer.providerServiceId;
    }

    const pricingSnapshot = await deps.priceRoutedService(
        selectedService,
        providerOffer,
        validatedRequest.totalQuantity,
        { session }
    );

    if (isDripFeed && pricingSnapshot.sellingTotalMinor < validatedRequest.runs) {
        const error = new Error('Order value is too small for the requested number of drip-feed runs');
        error.statusCode = 400;
        error.code = 'DRIP_FEED_VALUE_TOO_SMALL';
        throw error;
    }

    return {
        selectedService,
        catalogueService,
        isManual,
        isDripFeed,
        providerOffer,
        providerServiceId,
        pricingSnapshot,
    };
}

/**
 * Reduces an internal price snapshot to the fields a customer may see.
 *
 * Provider cost, gross spread, and provider identifiers are internal commercial
 * data and must never reach the browser.
 */
function toCustomerQuote(pricingSnapshot, validatedRequest) {
    return {
        serviceId: validatedRequest.serviceId,
        quantity: validatedRequest.quantity,
        runs: validatedRequest.runs,
        totalQuantity: validatedRequest.totalQuantity,
        sellingRateMinor: pricingSnapshot.sellingRateMinor,
        pricingUnit: pricingSnapshot.pricingUnit,
        totalMinor: pricingSnapshot.sellingTotalMinor,
        currency: pricingSnapshot.currency,
        pricedAt: pricingSnapshot.pricedAt,
    };
}

module.exports = { resolveOrderPricing, toCustomerQuote };
