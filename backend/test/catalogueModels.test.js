const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const CatalogueService = require('../models/CatalogueService');
const Provider = require('../models/Provider');
const ProviderOffer = require('../models/ProviderOffer');
const LegacyService = require('../models/Service');
const ProviderSyncRun = require('../models/ProviderSyncRun');

test('catalogue and offer quantities must be safe positive integer ranges', async () => {
    const catalogue = new CatalogueService({
        slug: 'instagram-followers', displayName: 'Instagram Followers',
        min: 100, max: 99, pricingUnit: 1000,
    });
    await assert.rejects(catalogue.validate(), /max must be greater than or equal to min/);

    const offer = new ProviderOffer({
        providerId: new mongoose.Types.ObjectId(), providerServiceId: '17',
        providerNameSnapshot: 'Followers', costRateMinor: 10,
        min: 1.5, max: 100, lastSeenAt: new Date(),
    });
    await assert.rejects(offer.validate(), /min must be a safe integer/);
});

test('provider credentials are excluded by default and provider offer identity is unique', () => {
    assert.equal(Provider.schema.path('credentialReference').options.select, false);
    const uniqueIndex = ProviderOffer.schema.indexes().find(([keys, options]) =>
        keys.providerId === 1 && keys.providerServiceId === 1 && options.unique
    );
    assert.ok(uniqueIndex);
});

test('provider configuration accepts only server credential references and HTTP endpoints', async () => {
    const invalidReference = new Provider({
        code: 'provider-one', name: 'Provider One', adapterType: 'LEGACY_SMM',
        apiBaseUrl: 'https://provider.invalid', credentialReference: 'raw-secret',
    });
    await assert.rejects(invalidReference.validate(), /credentialReference/);

    const invalidUrl = new Provider({
        code: 'provider-two', name: 'Provider Two', adapterType: 'LEGACY_SMM',
        apiBaseUrl: 'file:///secret', credentialReference: 'env:PROVIDER_TWO_KEY',
    });
    await assert.rejects(invalidUrl.validate(), /http or https/);
});

test('legacy Service remains available with an additive catalogue link', () => {
    assert.ok(LegacyService.schema.path('serviceId'));
    assert.ok(LegacyService.schema.path('service'));
    assert.equal(LegacyService.schema.path('catalogueServiceId').options.ref, 'CatalogueService');
});

test('provider sync request IDs have database-backed idempotency per admin', () => {
    const index = ProviderSyncRun.schema.indexes().find(([keys, options]) =>
        keys.triggeredBy === 1 && keys.requestId === 1 && options.unique
    );
    assert.ok(index);
});

test('provider sync application has database-backed idempotency per admin', () => {
    const index = ProviderSyncRun.schema.indexes().find(([keys, options]) =>
        keys.appliedBy === 1 && keys.applyRequestId === 1 && options.unique
    );
    assert.ok(index);
    assert.deepEqual(index[1].partialFilterExpression, { applyRequestId: { $type: 'string' } });
});
