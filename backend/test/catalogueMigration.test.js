const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildLegacyMapping, legacySlug } = require('../scripts/mapLegacyServicesToCatalogue');

test('legacy mapping preserves customer and provider identifiers separately', () => {
    const migratedAt = new Date('2026-01-01T00:00:00Z');
    const mapping = buildLegacyMapping({
        serviceId: 'customer-followers', service: 'provider-991',
        name: 'Followers', internalName: 'Provider Followers', rate: '1.23',
        min: '100', max: '10000', refill: true, markupOverrideBps: 500,
    }, migratedAt);
    assert.equal(mapping.catalogue.legacyServiceId, 'customer-followers');
    assert.equal(mapping.offer.providerServiceId, 'provider-991');
    assert.equal(mapping.offer.costRateMinor, 123);
    assert.equal(mapping.catalogue.visibility, 'ASSIGNED_ONLY');
    assert.equal(mapping.catalogue.migrationProvenance.migratedAt, migratedAt);
});

test('legacy slugs are deterministic and distinguish normalized collisions', () => {
    assert.equal(legacySlug('A B'), legacySlug('A B'));
    assert.notEqual(legacySlug('A B'), legacySlug('A-B'));
});

test('invalid legacy ranges are rejected instead of fabricated', () => {
    assert.throws(() => buildLegacyMapping({
        serviceId: 'bad', service: '1', name: 'Bad', rate: 1, min: '100', max: '10',
    }), /max must be greater/);
});
