const ProviderOffer = require('../models/ProviderOffer');

class ProviderRoutingError extends Error {
    constructor(message, code = 'PROVIDER_ROUTING_FAILED', statusCode = 409) {
        super(message);
        this.name = 'ProviderRoutingError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function id(value) {
    return value?._id ? String(value._id) : value ? String(value) : null;
}

function isEligibleOffer(offer, quantity) {
    const provider = offer?.providerId;
    return offer?.availability === 'AVAILABLE'
        && Number.isSafeInteger(offer.min)
        && Number.isSafeInteger(offer.max)
        && offer.min <= quantity
        && offer.max >= quantity
        && provider
        && provider.enabled === true
        && provider.healthStatus !== 'UNAVAILABLE';
}

function chooseManualPriorityOffer({ catalogueService, offers, quantity }) {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        throw new ProviderRoutingError('Routing quantity is invalid', 'INVALID_ROUTING_QUANTITY', 400);
    }
    if (catalogueService?.routingStrategy && catalogueService.routingStrategy !== 'MANUAL_PRIORITY') {
        throw new ProviderRoutingError(
            'Only manual-priority routing is enabled',
            'ROUTING_STRATEGY_NOT_ENABLED'
        );
    }
    const eligible = offers.filter((offer) => isEligibleOffer(offer, quantity)
        && (!catalogueService || offer.pricingUnit === catalogueService.pricingUnit));
    const primaryId = id(catalogueService?.primaryProviderId);
    const fallbackId = id(catalogueService?.fallbackProviderId);
    if (primaryId && fallbackId && primaryId === fallbackId) {
        throw new ProviderRoutingError(
            'Primary and fallback providers must be different',
            'INVALID_PROVIDER_PRIORITY'
        );
    }
    if (primaryId) {
        const primary = eligible.find((offer) => id(offer.providerId) === primaryId);
        if (primary) return { offer: primary, selectedRole: 'PRIMARY' };
        if (fallbackId) {
            const fallback = eligible.find((offer) => id(offer.providerId) === fallbackId);
            if (fallback) return { offer: fallback, selectedRole: 'FALLBACK' };
        }
        throw new ProviderRoutingError(
            'No configured provider can fulfil this quantity',
            'NO_PROVIDER_AVAILABLE'
        );
    }
    if (eligible.length === 1) {
        return { offer: eligible[0], selectedRole: 'LEGACY_SINGLE_PROVIDER' };
    }
    if (eligible.length > 1) {
        throw new ProviderRoutingError(
            'Primary provider must be configured when multiple offers are available',
            'PROVIDER_PRIORITY_REQUIRED'
        );
    }
    throw new ProviderRoutingError('No provider offer can fulfil this quantity', 'NO_PROVIDER_AVAILABLE');
}

async function selectManualPriorityOffer({ catalogueService, providerServiceId, quantity, session }, overrides = {}) {
    const OfferModel = overrides.ProviderOffer || ProviderOffer;
    const filter = {
        availability: 'AVAILABLE',
        min: { $lte: quantity },
        max: { $gte: quantity },
        ...(catalogueService?._id
            ? { catalogueServiceId: catalogueService._id }
            : { providerServiceId }),
    };
    let query = OfferModel.find(filter).populate({
        path: 'providerId',
        select: 'code name enabled priority healthStatus adapterType',
    });
    if (session && typeof query.session === 'function') query = query.session(session);
    const offers = await query;
    return chooseManualPriorityOffer({ catalogueService, offers, quantity });
}

module.exports = {
    ProviderRoutingError,
    chooseManualPriorityOffer,
    isEligibleOffer,
    selectManualPriorityOffer,
};
