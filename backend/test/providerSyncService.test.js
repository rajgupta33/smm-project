const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    applyProviderSyncReport,
    buildProviderSyncReport,
    proposedMissingAvailability,
} = require('../services/providerSyncService');
const mongoose = require('mongoose');
const ProviderOffer = require('../models/ProviderOffer');

function query(value) {
    return { session() { return Promise.resolve(value); } };
}

function applicationHarness({ currentOffers = [], runOverrides = {} } = {}) {
    const ids = {
        run: '507f1f77bcf86cd799439011',
        provider: '507f1f77bcf86cd799439012',
        admin: '507f1f77bcf86cd799439013',
        catalogue: '507f1f77bcf86cd799439014',
    };
    const run = {
        _id: ids.run,
        providerId: ids.provider,
        status: 'COMPLETED',
        applicationStatus: 'PENDING',
        completedAt: new Date('2026-08-29T10:00:00.000Z'),
        report: {
            generatedAt: new Date('2026-08-29T09:59:00.000Z'),
            seen: [], new: [], changed: [], missing: [], invalid: [],
        },
        async save(options) { this.savedWith = options; },
        ...runOverrides,
    };
    const writes = [];
    function ProviderOfferModel(value) { return new ProviderOffer(value); }
    ProviderOfferModel.find = () => query(currentOffers);
    ProviderOfferModel.bulkWrite = async (operations, options) => { writes.push({ operations, options }); };
    const SyncRunModel = {
        findById: () => query(run),
        findOne: () => query(null),
    };
    const audit = [];
    const session = {
        async withTransaction(operation) { await operation(); },
        async endSession() { this.ended = true; },
    };
    return {
        ids, run, writes, audit, session,
        dependencies: {
            mongoose: { isValidObjectId: mongoose.isValidObjectId, async startSession() { return session; } },
            ProviderOffer: ProviderOfferModel,
            ProviderSyncRun: SyncRunModel,
            CatalogueService: {
                find() {
                    return query([{
                        _id: new mongoose.Types.ObjectId(ids.catalogue),
                        fulfilmentType: 'PROVIDER', pricingUnit: 1000, min: 50, max: 2000,
                    }]);
                },
            },
            AuditLog: { async create(entries, options) { audit.push({ entries, options }); } },
        },
    };
}

function storedOffer(providerId, providerServiceId, overrides = {}) {
    const offer = new ProviderOffer({
        providerId,
        providerServiceId,
        providerNameSnapshot: `Offer ${providerServiceId}`,
        providerCategorySnapshot: '',
        providerDescriptionSnapshot: '',
        costRateMinor: 100,
        pricingUnit: 1000,
        min: 100,
        max: 1000,
        supportsRefill: false,
        availability: 'AVAILABLE',
        consecutiveMissingSyncs: 0,
        lastSeenAt: new Date('2026-08-01T00:00:00.000Z'),
        ...overrides,
    });
    offer.updatedAt = overrides.updatedAt || new Date('2026-08-01T00:00:00.000Z');
    return offer;
}

test('report-only synchronization classifies changes without mutating stored offers', () => {
    const existing = [{
        providerServiceId: '1', providerNameSnapshot: 'Old name',
        providerCategorySnapshot: 'Social', providerDescriptionSnapshot: '',
        costRateMinor: 100, pricingUnit: 1000, min: 100, max: 1000,
        supportsRefill: false, availability: 'AVAILABLE', consecutiveMissingSyncs: 0,
    }, {
        providerServiceId: 'missing', availability: 'AVAILABLE', consecutiveMissingSyncs: 0,
    }];
    const before = JSON.stringify(existing);
    const fetched = [{
        providerServiceId: '1', name: 'New name', category: 'Social', description: '',
        rate: '1.00', min: '100', max: '1000', supportsRefill: false,
    }, {
        providerServiceId: '2', name: 'New service', category: '', description: '',
        rate: '2.50', min: '50', max: '500', supportsRefill: true,
    }, {
        providerServiceId: '', name: 'Invalid', rate: '1', min: '1', max: '2',
    }];
    const report = buildProviderSyncReport(fetched, existing, new Date('2026-01-01T00:00:00Z'));

    assert.deepEqual(report.counts, { fetched: 3, existing: 2, new: 1, changed: 1, missing: 1, invalid: 1 });
    assert.deepEqual(report.changed[0].fields, ['providerNameSnapshot']);
    assert.equal(report.new[0].costRateMinor, 250);
    assert.equal(report.missing[0].proposedAvailability, 'SUSPECTED_UNAVAILABLE');
    assert.equal(JSON.stringify(existing), before);
});

test('missing offers require two consecutive reports before proposed unavailability', () => {
    assert.equal(proposedMissingAvailability({ consecutiveMissingSyncs: 0 }), 'SUSPECTED_UNAVAILABLE');
    assert.equal(proposedMissingAvailability({ consecutiveMissingSyncs: 1 }), 'UNAVAILABLE');

    const fetched = [];
    const existing = [{
        providerServiceId: 'missing', availability: 'AVAILABLE', consecutiveMissingSyncs: 0,
    }];
    const first = buildProviderSyncReport(fetched, existing);
    const second = buildProviderSyncReport(fetched, existing, new Date(), first.missing);
    assert.equal(first.missing[0].proposedAvailability, 'SUSPECTED_UNAVAILABLE');
    assert.equal(second.missing[0].proposedAvailability, 'UNAVAILABLE');
    assert.equal(second.missing[0].consecutiveMissingSyncs, 2);
});

test('reviewed synchronization applies only stored report values and optional catalogue mappings transactionally', async () => {
    const base = applicationHarness();
    const changed = storedOffer(base.ids.provider, 'changed');
    const missing = storedOffer(base.ids.provider, 'missing');
    const unchanged = storedOffer(base.ids.provider, 'unchanged', { consecutiveMissingSyncs: 1 });
    const harness = applicationHarness({
        currentOffers: [changed, missing, unchanged],
        runOverrides: {
            report: {
                generatedAt: new Date('2026-08-29T09:59:00.000Z'),
                seen: ['new', 'changed', 'unchanged'],
                new: [{
                    providerServiceId: 'new', providerNameSnapshot: 'Provider-authored name',
                    providerCategorySnapshot: '', providerDescriptionSnapshot: '',
                    costRateMinor: 250, pricingUnit: 1000, min: 50, max: 500,
                    supportsRefill: true,
                }],
                changed: [{
                    providerServiceId: 'changed', fields: ['costRateMinor'],
                    before: { costRateMinor: 100 }, after: { costRateMinor: 175 },
                }],
                missing: [{
                    providerServiceId: 'missing', currentAvailability: 'AVAILABLE',
                    proposedAvailability: 'SUSPECTED_UNAVAILABLE', consecutiveMissingSyncs: 1,
                }],
                invalid: [{ providerServiceId: 'bad' }],
            },
        },
    });

    const result = await applyProviderSyncReport({
        runId: harness.ids.run,
        actorId: harness.ids.admin,
        requestId: 'apply-request-1',
        catalogueMappings: [{ providerServiceId: 'new', catalogueServiceId: harness.ids.catalogue }],
    }, harness.dependencies);

    assert.equal(result.idempotentReplay, false);
    assert.equal(harness.writes.length, 1);
    const operations = harness.writes[0].operations;
    assert.equal(operations.length, 4);
    assert.equal(operations[0].insertOne.document.costRateMinor, 250);
    assert.equal(String(operations[0].insertOne.document.catalogueServiceId), harness.ids.catalogue);
    assert.equal(operations[1].updateOne.update.$set.costRateMinor, 175);
    assert.equal(operations[2].updateOne.update.$set.availability, 'SUSPECTED_UNAVAILABLE');
    assert.equal(operations[3].updateOne.update.$set.consecutiveMissingSyncs, 0);
    assert.deepEqual(harness.run.applyCounts, { inserted: 1, updated: 1, seen: 1, missing: 1, mapped: 1 });
    assert.equal(harness.run.applicationStatus, 'APPLIED');
    assert.equal(harness.audit.length, 1);
    assert.equal(harness.audit[0].entries[0].metadata.invalidEntriesSkipped, 1);
    assert.equal(harness.audit[0].options.session, harness.session);
    assert.equal(harness.session.ended, true);
});

test('synchronization application rejects stale offer state without writing', async () => {
    const base = applicationHarness();
    const changed = storedOffer(base.ids.provider, 'changed', {
        updatedAt: new Date('2026-08-29T10:01:00.000Z'),
    });
    const harness = applicationHarness({
        currentOffers: [changed],
        runOverrides: {
            report: {
                generatedAt: new Date('2026-08-29T09:59:00.000Z'),
                seen: ['changed'], new: [], missing: [], invalid: [],
                changed: [{ providerServiceId: 'changed', before: { costRateMinor: 100 }, after: { costRateMinor: 200 } }],
            },
        },
    });

    await assert.rejects(
        applyProviderSyncReport({
            runId: harness.ids.run, actorId: harness.ids.admin,
            requestId: 'apply-request-stale', catalogueMappings: [],
        }, harness.dependencies),
        (error) => error.code === 'SYNC_REPORT_STALE' && error.statusCode === 409
    );
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.session.ended, true);
});

test('replaying an applied synchronization request never writes offers twice', async () => {
    const harness = applicationHarness({ runOverrides: { applicationStatus: 'APPLIED' } });
    harness.dependencies.ProviderSyncRun.findOne = (filter) => query(
        filter.applyRequestId === 'apply-request-replay' ? harness.run : null
    );

    const result = await applyProviderSyncReport({
        runId: harness.ids.run,
        actorId: harness.ids.admin,
        requestId: 'apply-request-replay',
        catalogueMappings: [],
    }, harness.dependencies);

    assert.equal(result.idempotentReplay, true);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.audit.length, 0);
});
