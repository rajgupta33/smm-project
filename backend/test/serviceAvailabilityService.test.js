const assert = require('node:assert/strict');
const test = require('node:test');
const {
    alertKeys,
    classifyReportAnomaly,
    scanServiceAvailability,
} = require('../services/serviceAvailabilityService');

const NOW = new Date('2026-09-16T06:00:00Z');

function report(overrides = {}) {
    return {
        counts: { fetched: 10, existing: 10, new: 0, changed: 0, missing: 0, invalid: 0 },
        new: [], changed: [], missing: [], invalid: [], seen: [],
        ...overrides,
    };
}

test('a provider returning zero services is an anomaly, not mass removal', () => {
    assert.deepEqual(
        classifyReportAnomaly(report({ counts: { fetched: 0, existing: 10, missing: 0 } })),
        { anomalous: true, reason: 'PROVIDER_RETURNED_NO_SERVICES' }
    );
});

test('losing more than 30% of known offers at once is an anomaly', () => {
    const borderline = classifyReportAnomaly(report({ counts: { fetched: 10, existing: 10, missing: 3 } }));
    assert.equal(borderline.anomalous, false);
    const anomalous = classifyReportAnomaly(report({ counts: { fetched: 10, existing: 10, missing: 4 } }));
    assert.equal(anomalous.anomalous, true);
    assert.equal(anomalous.reason, 'TOO_MANY_SERVICES_MISSING_AT_ONCE');
});

test('a provider with no prior known offers cannot trip the missing-ratio check', () => {
    assert.equal(classifyReportAnomaly(report({ counts: { fetched: 5, existing: 0, missing: 0 } })).anomalous, false);
});

function harness({ providers = [{ _id: 'provider-1', name: 'Main provider' }], reports = {} } = {}) {
    const offers = new Map();
    const catalogues = new Map();
    const raised = [];
    const resolved = [];
    const overrides = {
        Provider: {
            find: () => ({ select: async () => providers }),
        },
        createProviderSyncReport: async (provider) => reports[provider._id] || report(),
        ProviderOffer: {
            async findOne({ providerId, providerServiceId }) {
                return [...offers.values()].find((offer) => offer.providerId === providerId && offer.providerServiceId === providerServiceId) || null;
            },
            async updateOne({ _id }, update) {
                Object.assign(offers.get(_id), update.$set);
                return { modifiedCount: 1 };
            },
            async exists({ catalogueServiceId, availability, _id: excluded }) {
                return [...offers.values()].some((offer) => (
                    offer.catalogueServiceId === catalogueServiceId
                        && offer.availability === availability
                        && offer._id !== excluded?.$ne
                )) || null;
            },
        },
        CatalogueService: {
            async findById(id) { return catalogues.get(id) || null; },
            async updateOne({ _id }, update) {
                Object.assign(catalogues.get(_id), update.$set);
                return { modifiedCount: 1 };
            },
        },
        raiseAlert: async (input) => { raised.push(input); },
        resolveAlert: async (input) => { resolved.push(input.dedupeKey); },
    };
    return {
        offers, catalogues, raised, resolved,
        addOffer(offer) { offers.set(offer._id, { availability: 'AVAILABLE', catalogueServiceId: null, ...offer }); },
        addCatalogue(catalogue) { catalogues.set(catalogue._id, { active: true, autoHiddenAt: null, ...catalogue }); },
        options: { overrides, now: NOW },
    };
}

test('a confirmed removal with no other offer hides the catalogue service and raises a critical alert', async () => {
    const context = harness({
        reports: {
            'provider-1': report({
                counts: { fetched: 9, existing: 10, missing: 1 },
                missing: [{ providerServiceId: 'ps-1', currentAvailability: 'SUSPECTED_UNAVAILABLE', proposedAvailability: 'UNAVAILABLE', consecutiveMissingSyncs: 2 }],
            }),
        },
    });
    context.addOffer({ _id: 'offer-1', providerId: 'provider-1', providerServiceId: 'ps-1', providerNameSnapshot: 'Followers', catalogueServiceId: 'cat-1' });
    context.addCatalogue({ _id: 'cat-1', displayName: 'Instagram Followers' });

    const result = await scanServiceAvailability(context.options);
    assert.deepEqual(result.totals, { scanned: 1, checked: 1, anomalous: 0, failed: 0, removed: 1, offerRemoved: 0, reappeared: 0 });
    assert.equal(context.offers.get('offer-1').availability, 'UNAVAILABLE');
    assert.equal(context.catalogues.get('cat-1').active, false);
    assert.deepEqual(context.catalogues.get('cat-1').autoHiddenAt, NOW);
    assert.equal(raised(context, 0).type, 'SERVICE_REMOVED');
    assert.equal(raised(context, 0).severity, 'CRITICAL');
    assert.equal(raised(context, 0).dedupeKey, alertKeys.removed('cat-1'));
});

function raised(context, index) {
    return context.raised[index];
}

test('a first miss is applied silently: no alert and no hide', async () => {
    const context = harness({
        reports: {
            'provider-1': report({
                counts: { fetched: 9, existing: 10, missing: 1 },
                missing: [{ providerServiceId: 'ps-1', currentAvailability: 'AVAILABLE', proposedAvailability: 'SUSPECTED_UNAVAILABLE', consecutiveMissingSyncs: 1 }],
            }),
        },
    });
    context.addOffer({ _id: 'offer-1', providerId: 'provider-1', providerServiceId: 'ps-1', catalogueServiceId: 'cat-1' });
    context.addCatalogue({ _id: 'cat-1', displayName: 'Instagram Followers' });

    const result = await scanServiceAvailability(context.options);
    assert.deepEqual(result.totals, { scanned: 1, checked: 1, anomalous: 0, failed: 0, removed: 0, offerRemoved: 0, reappeared: 0 });
    assert.equal(context.offers.get('offer-1').availability, 'SUSPECTED_UNAVAILABLE');
    assert.equal(context.catalogues.get('cat-1').active, true);
    assert.equal(context.raised.length, 0);
});

test('a confirmed removal with a fallback offer stays on sale but still warns', async () => {
    const context = harness({
        reports: {
            'provider-1': report({
                counts: { fetched: 9, existing: 10, missing: 1 },
                missing: [{ providerServiceId: 'ps-1', currentAvailability: 'SUSPECTED_UNAVAILABLE', proposedAvailability: 'UNAVAILABLE', consecutiveMissingSyncs: 2 }],
            }),
        },
    });
    context.addOffer({ _id: 'offer-1', providerId: 'provider-1', providerServiceId: 'ps-1', providerNameSnapshot: 'Followers', catalogueServiceId: 'cat-1' });
    context.addOffer({ _id: 'offer-2', providerId: 'provider-2', providerServiceId: 'ps-2', catalogueServiceId: 'cat-1', availability: 'AVAILABLE' });
    context.addCatalogue({ _id: 'cat-1', displayName: 'Instagram Followers' });

    const result = await scanServiceAvailability(context.options);
    assert.deepEqual(result.totals, { scanned: 1, checked: 1, anomalous: 0, failed: 0, removed: 0, offerRemoved: 1, reappeared: 0 });
    assert.equal(context.catalogues.get('cat-1').active, true);
    assert.equal(raised(context, 0).type, 'SERVICE_OFFER_REMOVED');
    assert.equal(raised(context, 0).severity, 'WARNING');
});

test('an unmapped missing offer updates state without any alert', async () => {
    const context = harness({
        reports: {
            'provider-1': report({
                counts: { fetched: 9, existing: 10, missing: 1 },
                missing: [{ providerServiceId: 'ps-1', currentAvailability: 'SUSPECTED_UNAVAILABLE', proposedAvailability: 'UNAVAILABLE', consecutiveMissingSyncs: 2 }],
            }),
        },
    });
    context.addOffer({ _id: 'offer-1', providerId: 'provider-1', providerServiceId: 'ps-1', catalogueServiceId: null });

    const result = await scanServiceAvailability(context.options);
    assert.equal(context.offers.get('offer-1').availability, 'UNAVAILABLE');
    assert.equal(context.raised.length, 0);
    assert.equal(result.totals.removed, 0);
});

test('a reappeared offer clears its alerts; an auto-hidden catalogue stays hidden but is flagged for review', async () => {
    const context = harness({
        reports: {
            'provider-1': report({
                changed: [{ providerServiceId: 'ps-1', fields: ['availability'], before: { availability: 'UNAVAILABLE' }, after: { availability: 'AVAILABLE' } }],
            }),
        },
    });
    context.addOffer({ _id: 'offer-1', providerId: 'provider-1', providerServiceId: 'ps-1', providerNameSnapshot: 'Followers', catalogueServiceId: 'cat-1', availability: 'UNAVAILABLE', consecutiveMissingSyncs: 2 });
    context.addCatalogue({ _id: 'cat-1', displayName: 'Instagram Followers', active: false, autoHiddenAt: new Date('2026-09-15T00:00:00Z') });

    const result = await scanServiceAvailability(context.options);
    assert.deepEqual(result.totals, { scanned: 1, checked: 1, anomalous: 0, failed: 0, removed: 0, offerRemoved: 0, reappeared: 1 });
    assert.equal(context.offers.get('offer-1').availability, 'AVAILABLE');
    assert.equal(context.offers.get('offer-1').consecutiveMissingSyncs, 0);
    // Reappearance never auto-unhides; only a human reactivation should re-expose it to customers.
    assert.equal(context.catalogues.get('cat-1').active, false);
    assert.deepEqual(context.resolved.sort(), [
        alertKeys.syncAnomaly('provider-1'), alertKeys.offerRemoved('offer-1'), alertKeys.removed('cat-1'),
    ].sort());
    assert.equal(context.raised[0].type, 'SERVICE_REAPPEARED');
    assert.equal(context.raised[0].severity, 'INFO');
});

test('a cost-only change with no availability field is left for manual review', async () => {
    const context = harness({
        reports: {
            'provider-1': report({
                changed: [{ providerServiceId: 'ps-1', fields: ['costRateMinor'], before: { costRateMinor: 100 }, after: { costRateMinor: 200 } }],
            }),
        },
    });
    context.addOffer({ _id: 'offer-1', providerId: 'provider-1', providerServiceId: 'ps-1', catalogueServiceId: 'cat-1' });
    context.addCatalogue({ _id: 'cat-1', displayName: 'Instagram Followers' });

    await scanServiceAvailability(context.options);
    assert.equal(context.raised.length, 0);
});

test('an anomalous report changes nothing and raises one alert instead of many removals', async () => {
    const context = harness({
        reports: {
            'provider-1': report({ counts: { fetched: 0, existing: 10, missing: 0 } }),
        },
    });
    context.addOffer({ _id: 'offer-1', providerId: 'provider-1', providerServiceId: 'ps-1', catalogueServiceId: 'cat-1' });
    context.addCatalogue({ _id: 'cat-1', displayName: 'Instagram Followers' });

    const result = await scanServiceAvailability(context.options);
    assert.deepEqual(result.totals, { scanned: 1, checked: 0, anomalous: 1, failed: 0, removed: 0, offerRemoved: 0, reappeared: 0 });
    assert.equal(context.offers.get('offer-1').availability, 'AVAILABLE');
    assert.equal(context.raised.length, 1);
    assert.equal(context.raised[0].type, 'PROVIDER_SYNC_ANOMALY');
});

test('one provider failing does not stop the scan of the others', async () => {
    const context = harness({
        providers: [{ _id: 'provider-1', name: 'A' }, { _id: 'provider-2', name: 'B' }],
        reports: { 'provider-2': report() },
    });
    context.options.overrides.createProviderSyncReport = async (provider) => {
        if (provider._id === 'provider-1') throw new Error('provider unreachable');
        return report();
    };
    const originalError = console.error;
    console.error = () => {};
    try {
        const result = await scanServiceAvailability(context.options);
        assert.deepEqual(result.totals, { scanned: 2, checked: 1, anomalous: 0, failed: 1, removed: 0, offerRemoved: 0, reappeared: 0 });
    } finally {
        console.error = originalError;
    }
});
