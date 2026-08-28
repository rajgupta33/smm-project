const assert = require('node:assert/strict');
const test = require('node:test');

const {
    calculateLegacyOrderPrice,
    validateOrderRequest,
    validateServiceForUser,
} = require('../services/orderValidationService');

const assignedService = {
    serviceId: 'instagram-followers-standard',
    service: '101',
    rate: 125,
    min: '100',
    max: '10000',
};

const assignedUser = {
    services: ['instagram-followers-standard'],
};

test('browser financial and provider fields do not enter validated order input', () => {
    const validated = validateOrderRequest({
        serviceId: 'instagram-followers-standard',
        linkInput: 'https://example.com/profile',
        quantity: 5000,
        providerServiceId: 'attacker-provider-id',
        service: 'attacker-provider-id',
        rate: 0,
        totalAmount: -100000,
        refill: true,
    });

    assert.deepEqual(validated, {
        serviceId: 'instagram-followers-standard',
        target: 'https://example.com/profile',
        quantity: 5000,
        runs: 1,
        interval: 0,
        totalQuantity: 5000,
    });
    assert.equal('rate' in validated, false);
    assert.equal('totalAmount' in validated, false);
    assert.equal('providerServiceId' in validated, false);
    assert.equal('refill' in validated, false);

    const mapping = validateServiceForUser(assignedService, assignedUser, validated.quantity);
    const price = calculateLegacyOrderPrice(assignedService, validated.quantity);
    assert.equal(mapping.providerServiceId, '101');
    assert.equal(price.rateMajor, 125);
    assert.equal(price.totalMinor, 62500);
    assert.equal(price.totalMajor, 625);
});

for (const invalidQuantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-number']) {
    test(`rejects invalid quantity ${String(invalidQuantity)}`, () => {
        assert.throws(() => validateOrderRequest({
            serviceId: assignedService.serviceId,
            linkInput: 'https://example.com/profile',
            quantity: invalidQuantity,
        }), /positive integer/);
    });
}

test('rejects quantities outside the configured service range', () => {
    assert.throws(
        () => validateServiceForUser(assignedService, assignedUser, 99),
        /between 100 and 10000/
    );
    assert.throws(
        () => validateServiceForUser(assignedService, assignedUser, 10001),
        /between 100 and 10000/
    );
});

test('validates bounded drip-feed runs, interval, and safe total quantity', () => {
    const validated = validateOrderRequest({
        serviceId: assignedService.serviceId,
        linkInput: 'https://example.com/profile',
        quantity: 500,
        runs: 4,
        interval: 60,
    });
    assert.equal(validated.quantity, 500);
    assert.equal(validated.totalQuantity, 2000);
    assert.equal(validated.runs, 4);
    assert.equal(validated.interval, 60);

    assert.throws(() => validateOrderRequest({
        serviceId: assignedService.serviceId,
        linkInput: 'https://example.com/profile',
        quantity: 500,
        runs: 101,
        interval: 60,
    }), (error) => error.code === 'INVALID_RUNS');
    assert.throws(() => validateOrderRequest({
        serviceId: assignedService.serviceId,
        linkInput: 'https://example.com/profile',
        quantity: Number.MAX_SAFE_INTEGER,
        runs: 2,
        interval: 60,
    }), (error) => error.code === 'INVALID_ORDER_TOTAL');
});

test('rejects services that are not assigned to the customer', () => {
    assert.throws(
        () => validateServiceForUser(assignedService, { services: [] }, 1000),
        (error) => error.code === 'SERVICE_NOT_ASSIGNED' && error.statusCode === 403
    );
});

test('rejects malformed and unsafe targets', () => {
    for (const target of ['', 'not-a-url', 'javascript:alert(1)', 'ftp://example.com/file']) {
        assert.throws(() => validateOrderRequest({
            serviceId: assignedService.serviceId,
            linkInput: target,
            quantity: 100,
        }), /Target/);
    }
});
