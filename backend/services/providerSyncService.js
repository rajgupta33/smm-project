const ProviderOffer = require('../models/ProviderOffer');
const ProviderSyncRun = require('../models/ProviderSyncRun');
const CatalogueService = require('../models/CatalogueService');
const AuditLog = require('../models/AuditLog');
const mongoose = require('mongoose');
const { getProviderAdapterForProvider } = require('../providers/providerRegistry');
const { majorToMinor } = require('./pricingService');

class ProviderSyncError extends Error {
    constructor(message, code = 'PROVIDER_SYNC_FAILED', statusCode = 400) {
        super(message);
        this.name = 'ProviderSyncError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function positiveInteger(value, fieldName) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 1) {
        throw new ProviderSyncError(`${fieldName} must be a positive integer`, 'INVALID_PROVIDER_SERVICE');
    }
    return numeric;
}

function normalizeForComparison(service) {
    if (!service.providerServiceId || !service.name) {
        throw new ProviderSyncError('Provider service ID and name are required', 'INVALID_PROVIDER_SERVICE');
    }
    const min = positiveInteger(service.min, 'min');
    const max = positiveInteger(service.max, 'max');
    if (max < min) throw new ProviderSyncError('max must be greater than or equal to min', 'INVALID_PROVIDER_SERVICE');
    return {
        providerServiceId: service.providerServiceId,
        providerNameSnapshot: service.name,
        providerCategorySnapshot: service.category,
        providerDescriptionSnapshot: service.description,
        costRateMinor: majorToMinor(service.rate),
        pricingUnit: 1000,
        min,
        max,
        supportsRefill: service.supportsRefill,
    };
}

function changedFields(existing, current) {
    const fields = [
        'providerNameSnapshot',
        'providerCategorySnapshot',
        'providerDescriptionSnapshot',
        'costRateMinor',
        'pricingUnit',
        'min',
        'max',
        'supportsRefill',
    ];
    return fields.filter((field) => existing[field] !== current[field]);
}

function proposedMissingAvailability(offer) {
    return offer.consecutiveMissingSyncs >= 1 ? 'UNAVAILABLE' : 'SUSPECTED_UNAVAILABLE';
}

async function createProviderSyncReport(provider) {
    if (!provider.enabled) {
        throw new ProviderSyncError('Provider is disabled', 'PROVIDER_DISABLED', 409);
    }
    const adapter = getProviderAdapterForProvider(provider);
    const [fetched, existingOffers, previousRun] = await Promise.all([
        adapter.getServices(),
        ProviderOffer.find({ providerId: provider._id }).lean(),
        ProviderSyncRun.findOne({ providerId: provider._id, status: 'COMPLETED' })
            .sort({ startedAt: -1 })
            .select('report.missing')
            .lean(),
    ]);
    return buildProviderSyncReport(fetched, existingOffers, new Date(), previousRun?.report?.missing);
}

function buildProviderSyncReport(fetched, existingOffers, generatedAt = new Date(), previousMissing = []) {
    const existingByServiceId = new Map(
        existingOffers.map((offer) => [offer.providerServiceId, offer])
    );
    const seen = new Set();
    const previousMissingByServiceId = new Map(
        previousMissing.map((offer) => [offer.providerServiceId, offer.consecutiveMissingSyncs || 0])
    );
    const report = { new: [], changed: [], missing: [], invalid: [], seen: [] };

    for (const rawService of fetched) {
        try {
            const current = normalizeForComparison(rawService);
            if (seen.has(current.providerServiceId)) {
                throw new ProviderSyncError('Duplicate provider service ID', 'DUPLICATE_PROVIDER_SERVICE');
            }
            seen.add(current.providerServiceId);
            report.seen.push(current.providerServiceId);
            const existing = existingByServiceId.get(current.providerServiceId);
            if (!existing) {
                report.new.push(current);
                continue;
            }
            const fields = changedFields(existing, current);
            if (existing.availability !== 'AVAILABLE') fields.push('availability');
            if (fields.length) {
                report.changed.push({
                    providerServiceId: current.providerServiceId,
                    fields,
                    before: Object.fromEntries(fields.map((field) => [field, existing[field]])),
                    after: Object.fromEntries(fields.map((field) => [
                        field,
                        field === 'availability' ? 'AVAILABLE' : current[field],
                    ])),
                });
            }
        } catch (error) {
            report.invalid.push({
                providerServiceId: String(rawService.providerServiceId || ''),
                code: error.code || 'INVALID_PROVIDER_SERVICE',
                message: error.message,
            });
        }
    }

    for (const offer of existingOffers) {
        if (!seen.has(offer.providerServiceId)) {
            const priorMissingCount = Math.max(
                offer.consecutiveMissingSyncs || 0,
                previousMissingByServiceId.get(offer.providerServiceId) || 0
            );
            report.missing.push({
                providerServiceId: offer.providerServiceId,
                currentAvailability: offer.availability,
                proposedAvailability: proposedMissingAvailability({
                    consecutiveMissingSyncs: priorMissingCount,
                }),
                consecutiveMissingSyncs: priorMissingCount + 1,
            });
        }
    }

    return {
        mode: 'REPORT_ONLY',
        generatedAt,
        counts: {
            fetched: fetched.length,
            existing: existingOffers.length,
            new: report.new.length,
            changed: report.changed.length,
            missing: report.missing.length,
            invalid: report.invalid.length,
        },
        ...report,
    };
}

function requireText(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ProviderSyncError(`${fieldName} is required`, 'INVALID_SYNC_APPLICATION');
    }
    return value.trim();
}

function normalizeMappings(mappings = []) {
    if (!Array.isArray(mappings) || mappings.length > 5000) {
        throw new ProviderSyncError('Catalogue mappings are invalid', 'INVALID_SYNC_APPLICATION');
    }
    const normalized = new Map();
    for (const mapping of mappings) {
        const providerServiceId = requireText(mapping?.providerServiceId, 'providerServiceId');
        const catalogueServiceId = requireText(mapping?.catalogueServiceId, 'catalogueServiceId');
        if (!mongoose.isValidObjectId(catalogueServiceId)) {
            throw new ProviderSyncError('Catalogue service ID is invalid', 'INVALID_CATALOGUE_ID');
        }
        if (normalized.has(providerServiceId)) {
            throw new ProviderSyncError('A provider service was mapped more than once', 'DUPLICATE_PROVIDER_MAPPING');
        }
        normalized.set(providerServiceId, catalogueServiceId);
    }
    return normalized;
}

function valueMatches(left, right) {
    if (left instanceof Date || right instanceof Date) {
        return new Date(left).getTime() === new Date(right).getTime();
    }
    return left === right;
}

function assertChangedOfferIsCurrent(offer, change) {
    if (!offer) {
        throw new ProviderSyncError('A changed provider offer no longer exists', 'SYNC_REPORT_STALE', 409);
    }
    for (const [field, before] of Object.entries(change.before || {})) {
        if (!valueMatches(offer[field], before)) {
            throw new ProviderSyncError('Provider offer changed after this report was generated', 'SYNC_REPORT_STALE', 409);
        }
    }
}

function validateCatalogueMapping(catalogue, proposedOffer) {
    if (!catalogue || catalogue.fulfilmentType !== 'PROVIDER') {
        throw new ProviderSyncError('Mapped catalogue service must use provider fulfilment', 'INVALID_CATALOGUE_MAPPING', 409);
    }
    if (catalogue.pricingUnit !== proposedOffer.pricingUnit) {
        throw new ProviderSyncError('Provider offer and catalogue pricing units must match', 'INVALID_CATALOGUE_MAPPING', 409);
    }
    if (proposedOffer.max < catalogue.min || proposedOffer.min > catalogue.max) {
        throw new ProviderSyncError('Provider offer range does not overlap the catalogue range', 'INVALID_CATALOGUE_MAPPING', 409);
    }
}

function validateProposedOffer(ProviderOfferModel, value) {
    const validationError = new ProviderOfferModel(value).validateSync();
    if (validationError) {
        throw new ProviderSyncError('Stored synchronization report contains an invalid offer', 'INVALID_SYNC_REPORT', 409);
    }
}

async function sessionQuery(query, session) {
    return typeof query?.session === 'function' ? query.session(session) : query;
}

async function applyProviderSyncReport(input, overrides = {}) {
    const dependencies = {
        mongoose: overrides.mongoose || mongoose,
        ProviderOffer: overrides.ProviderOffer || ProviderOffer,
        ProviderSyncRun: overrides.ProviderSyncRun || ProviderSyncRun,
        CatalogueService: overrides.CatalogueService || CatalogueService,
        AuditLog: overrides.AuditLog || AuditLog,
    };
    const runId = requireText(input?.runId, 'runId');
    const actorId = input?.actorId;
    const requestId = requireText(input?.requestId, 'requestId').slice(0, 200);
    if (!dependencies.mongoose.isValidObjectId(runId) || !dependencies.mongoose.isValidObjectId(actorId)) {
        throw new ProviderSyncError('Synchronization run or administrator ID is invalid', 'INVALID_SYNC_APPLICATION');
    }
    const mappings = normalizeMappings(input.catalogueMappings);
    const session = await dependencies.mongoose.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            const replay = await sessionQuery(dependencies.ProviderSyncRun.findOne({
                appliedBy: actorId,
                applyRequestId: requestId,
            }), session);
            if (replay) {
                if (String(replay._id) !== String(runId)) {
                    throw new ProviderSyncError('Idempotency key was already used for another report', 'IDEMPOTENCY_CONFLICT', 409);
                }
                result = { run: replay, idempotentReplay: true };
                return;
            }

            const run = await sessionQuery(dependencies.ProviderSyncRun.findById(runId), session);
            if (!run) throw new ProviderSyncError('Synchronization report not found', 'SYNC_REPORT_NOT_FOUND', 404);
            if (run.status !== 'COMPLETED' || !run.report) {
                throw new ProviderSyncError('Only completed synchronization reports can be applied', 'SYNC_REPORT_NOT_READY', 409);
            }
            if (run.applicationStatus === 'APPLIED') {
                result = { run, idempotentReplay: true };
                return;
            }

            const newerRun = await sessionQuery(dependencies.ProviderSyncRun.findOne({
                providerId: run.providerId,
                status: 'COMPLETED',
                completedAt: { $gt: run.completedAt },
            }), session);
            if (newerRun) {
                throw new ProviderSyncError('A newer synchronization report exists', 'NEWER_SYNC_REPORT_EXISTS', 409);
            }

            const generatedAt = new Date(run.report.generatedAt);
            if (Number.isNaN(generatedAt.getTime())) {
                throw new ProviderSyncError('Synchronization report timestamp is invalid', 'INVALID_SYNC_REPORT', 409);
            }
            const currentOffers = await sessionQuery(dependencies.ProviderOffer.find({ providerId: run.providerId }), session);
            if (currentOffers.some((offer) => offer.updatedAt && new Date(offer.updatedAt) > generatedAt)) {
                throw new ProviderSyncError('Provider offers changed after this report was generated', 'SYNC_REPORT_STALE', 409);
            }
            const offersById = new Map(currentOffers.map((offer) => [offer.providerServiceId, offer]));
            const report = run.report;
            const seenIds = new Set(report.seen || [
                ...(report.new || []).map((offer) => offer.providerServiceId),
                ...(report.changed || []).map((offer) => offer.providerServiceId),
            ]);
            for (const providerServiceId of mappings.keys()) {
                if (!seenIds.has(providerServiceId)) {
                    throw new ProviderSyncError('Catalogue mapping is not present in this report', 'INVALID_PROVIDER_MAPPING', 409);
                }
            }

            const changedIds = new Set((report.changed || []).map((change) => change.providerServiceId));
            const existingChangedCatalogueIds = currentOffers
                .filter((offer) => changedIds.has(offer.providerServiceId) && offer.catalogueServiceId)
                .map((offer) => String(offer.catalogueServiceId));
            const catalogueIds = [...new Set([...mappings.values(), ...existingChangedCatalogueIds])];
            const catalogues = catalogueIds.length
                ? await sessionQuery(dependencies.CatalogueService.find({ _id: { $in: catalogueIds } }), session)
                : [];
            const cataloguesById = new Map(catalogues.map((catalogue) => [String(catalogue._id), catalogue]));
            if (cataloguesById.size !== catalogueIds.length) {
                throw new ProviderSyncError('Mapped catalogue service was not found', 'INVALID_CATALOGUE_MAPPING', 409);
            }

            const operations = [];
            const touched = new Set();
            const counts = { inserted: 0, updated: 0, seen: 0, missing: 0, mapped: mappings.size };
            for (const proposed of report.new || []) {
                if (offersById.has(proposed.providerServiceId)) {
                    throw new ProviderSyncError('A new provider offer now exists', 'SYNC_REPORT_STALE', 409);
                }
                const catalogueServiceId = mappings.get(proposed.providerServiceId) || null;
                if (catalogueServiceId) {
                    validateCatalogueMapping(cataloguesById.get(catalogueServiceId), proposed);
                }
                const document = {
                    ...proposed,
                    providerId: run.providerId,
                    catalogueServiceId,
                    availability: 'AVAILABLE',
                    consecutiveMissingSyncs: 0,
                    lastSeenAt: generatedAt,
                };
                validateProposedOffer(dependencies.ProviderOffer, document);
                operations.push({ insertOne: { document } });
                touched.add(proposed.providerServiceId);
                counts.inserted += 1;
            }

            for (const change of report.changed || []) {
                const offer = offersById.get(change.providerServiceId);
                assertChangedOfferIsCurrent(offer, change);
                const update = {
                    ...(change.after || {}),
                    availability: 'AVAILABLE',
                    consecutiveMissingSyncs: 0,
                    lastSeenAt: generatedAt,
                };
                const catalogueServiceId = mappings.get(change.providerServiceId)
                    || (offer.catalogueServiceId ? String(offer.catalogueServiceId) : null);
                if (mappings.has(change.providerServiceId)) update.catalogueServiceId = catalogueServiceId;
                const proposed = { ...offer.toObject(), ...update };
                if (catalogueServiceId) validateCatalogueMapping(cataloguesById.get(catalogueServiceId), proposed);
                validateProposedOffer(dependencies.ProviderOffer, proposed);
                operations.push({ updateOne: { filter: { _id: offer._id }, update: { $set: update } } });
                touched.add(change.providerServiceId);
                counts.updated += 1;
            }

            for (const missing of report.missing || []) {
                const offer = offersById.get(missing.providerServiceId);
                if (!offer || offer.availability !== missing.currentAvailability) {
                    throw new ProviderSyncError('A missing provider offer changed after this report', 'SYNC_REPORT_STALE', 409);
                }
                const update = {
                    availability: missing.proposedAvailability,
                    consecutiveMissingSyncs: missing.consecutiveMissingSyncs,
                };
                validateProposedOffer(dependencies.ProviderOffer, { ...offer.toObject(), ...update });
                operations.push({ updateOne: { filter: { _id: offer._id }, update: { $set: update } } });
                touched.add(missing.providerServiceId);
                counts.missing += 1;
            }

            for (const providerServiceId of seenIds) {
                if (touched.has(providerServiceId)) continue;
                const offer = offersById.get(providerServiceId);
                if (!offer) continue;
                const update = { lastSeenAt: generatedAt, availability: 'AVAILABLE', consecutiveMissingSyncs: 0 };
                const catalogueServiceId = mappings.get(providerServiceId);
                if (catalogueServiceId) {
                    update.catalogueServiceId = catalogueServiceId;
                    validateCatalogueMapping(cataloguesById.get(catalogueServiceId), { ...offer.toObject(), ...update });
                }
                operations.push({ updateOne: { filter: { _id: offer._id }, update: { $set: update } } });
                counts.seen += 1;
            }

            if (operations.length) {
                await dependencies.ProviderOffer.bulkWrite(operations, { session });
            }
            run.applicationStatus = 'APPLIED';
            run.appliedAt = new Date();
            run.appliedBy = actorId;
            run.applyRequestId = requestId;
            run.applyCounts = counts;
            await run.save({ session });
            await dependencies.AuditLog.create([{
                action: 'PROVIDER_SYNC_APPLIED',
                actorType: 'ADMIN',
                actorId,
                targetType: 'ProviderSyncRun',
                targetId: String(run._id),
                requestId,
                before: { applicationStatus: 'PENDING' },
                after: { applicationStatus: 'APPLIED', counts },
                metadata: { providerId: String(run.providerId), invalidEntriesSkipped: report.invalid?.length || 0 },
            }], { session });
            result = { run, idempotentReplay: false };
        });
        return result;
    } catch (error) {
        if (error?.code === 11000) {
            throw new ProviderSyncError('Synchronization application request conflicts with an existing request', 'IDEMPOTENCY_CONFLICT', 409);
        }
        throw error;
    } finally {
        await session.endSession();
    }
}

module.exports = {
    ProviderSyncError,
    changedFields,
    buildProviderSyncReport,
    applyProviderSyncReport,
    createProviderSyncReport,
    normalizeForComparison,
    proposedMissingAvailability,
};
