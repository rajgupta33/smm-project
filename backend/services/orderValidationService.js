const PRICING_UNIT = 1000;
const MAX_DRIP_FEED_RUNS = 100;
const MAX_DRIP_FEED_INTERVAL_MINUTES = 43200;

class OrderValidationError extends Error {
    constructor(message, code = 'INVALID_ORDER') {
        super(message);
        this.name = 'OrderValidationError';
        this.code = code;
        this.statusCode = 400;
    }
}

function normalizeServiceId(serviceId) {
    return typeof serviceId === 'string' ? serviceId.trim() : '';
}

function normalizeTarget(target) {
    return typeof target === 'string' ? target.trim() : '';
}

function parseQuantity(quantity) {
    const parsedQuantity = typeof quantity === 'number' ? quantity : Number(quantity);
    if (!Number.isFinite(parsedQuantity) || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
        throw new OrderValidationError('Quantity must be a positive integer', 'INVALID_QUANTITY');
    }
    return parsedQuantity;
}

function validateTarget(target) {
    const normalizedTarget = normalizeTarget(target);
    if (!normalizedTarget) {
        throw new OrderValidationError('Target link is required', 'INVALID_TARGET');
    }

    let parsedTarget;
    try {
        parsedTarget = new URL(normalizedTarget);
    } catch {
        throw new OrderValidationError('Target must be a valid URL', 'INVALID_TARGET');
    }

    if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
        throw new OrderValidationError('Target must use http or https', 'INVALID_TARGET');
    }

    return parsedTarget.toString();
}

function parseServiceLimit(value, fieldName) {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || !Number.isInteger(parsedValue) || parsedValue <= 0) {
        throw new OrderValidationError(`Service ${fieldName} is invalid`, 'INVALID_SERVICE_CONFIGURATION');
    }
    return parsedValue;
}

function toMinorUnits(amount) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
        throw new OrderValidationError('Service rate is invalid', 'INVALID_SERVICE_CONFIGURATION');
    }
    return Math.round((numericAmount + Number.EPSILON) * 100);
}

function validateOrderRequest(body = {}) {
    const serviceId = normalizeServiceId(body.serviceId);
    if (!serviceId) {
        throw new OrderValidationError('Service ID is required', 'INVALID_SERVICE');
    }

    const runs = body.runs ? parseQuantity(body.runs) : 1;
    const interval = body.interval ? parseQuantity(body.interval) : 0;
    const quantity = parseQuantity(body.quantity);
    
    if (runs > 1 && interval <= 0) {
        throw new OrderValidationError('Interval must be greater than 0 for drip feed', 'INVALID_INTERVAL');
    }
    if (runs > MAX_DRIP_FEED_RUNS) {
        throw new OrderValidationError(
            `Drip-feed runs cannot exceed ${MAX_DRIP_FEED_RUNS}`,
            'INVALID_RUNS'
        );
    }
    if (interval > MAX_DRIP_FEED_INTERVAL_MINUTES) {
        throw new OrderValidationError(
            `Drip-feed interval cannot exceed ${MAX_DRIP_FEED_INTERVAL_MINUTES} minutes`,
            'INVALID_INTERVAL'
        );
    }
    const totalQuantity = quantity * runs;
    if (!Number.isSafeInteger(totalQuantity)) {
        throw new OrderValidationError('Total drip-feed quantity is too large', 'INVALID_ORDER_TOTAL');
    }

    return {
        serviceId,
        quantity,
        runs,
        interval,
        totalQuantity,
        target: validateTarget(body.linkInput ?? body.target),
    };
}

function calculateLegacyOrderPrice(service, quantity) {
    const rateMinor = toMinorUnits(service.rate);
    if (rateMinor <= 0) {
        throw new OrderValidationError('Service rate must be greater than zero', 'INVALID_SERVICE_CONFIGURATION');
    }

    const unroundedTotal = rateMinor * quantity;
    if (!Number.isSafeInteger(unroundedTotal)) {
        throw new OrderValidationError('Calculated order total is too large', 'INVALID_ORDER_TOTAL');
    }

    const totalMinor = Math.ceil(unroundedTotal / PRICING_UNIT);
    return {
        rateMinor,
        rateMajor: rateMinor / 100,
        totalMinor,
        totalMajor: totalMinor / 100,
        pricingUnit: PRICING_UNIT,
    };
}

function validateServiceForUser(service, user, quantity, { requireProviderMapping = true } = {}) {
    if (!service) {
        throw new OrderValidationError('Service not found', 'INVALID_SERVICE');
    }

    const assignedServices = Array.isArray(user.services) ? user.services : [];
    if (!assignedServices.includes(service.serviceId)) {
        const error = new OrderValidationError('Service is not assigned to this user', 'SERVICE_NOT_ASSIGNED');
        error.statusCode = 403;
        throw error;
    }

    const minimum = parseServiceLimit(service.min, 'minimum');
    const maximum = parseServiceLimit(service.max, 'maximum');
    if (minimum > maximum) {
        throw new OrderValidationError('Service quantity limits are invalid', 'INVALID_SERVICE_CONFIGURATION');
    }
    if (quantity < minimum || quantity > maximum) {
        throw new OrderValidationError(
            `Quantity must be between ${minimum} and ${maximum}`,
            'QUANTITY_OUT_OF_RANGE'
        );
    }

    const providerServiceId = normalizeServiceId(service.service);
    if (requireProviderMapping && !providerServiceId) {
        throw new OrderValidationError('Service provider mapping is invalid', 'INVALID_SERVICE_CONFIGURATION');
    }

    return { minimum, maximum, providerServiceId: providerServiceId || null };
}

module.exports = {
    OrderValidationError,
    calculateLegacyOrderPrice,
    validateOrderRequest,
    validateServiceForUser,
};
