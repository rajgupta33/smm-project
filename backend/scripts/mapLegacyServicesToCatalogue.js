require('dotenv').config();
require('./migrationSafety');

const { createHash } = require('crypto');
const Service = require('../models/Service');
const CatalogueService = require('../models/CatalogueService');
const Provider = require('../models/Provider');
const ProviderOffer = require('../models/ProviderOffer');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');
const { majorToMinor } = require('../services/pricingService');

const PROVIDER_CODE = 'legacy-primary';
const MIGRATION_SOURCE = 'legacy_service_backfill_v1';

function positiveInteger(value, fieldName) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`${fieldName} must be a positive integer`);
    }
    return parsed;
}

function legacySlug(serviceId) {
    const normalized = String(serviceId).trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'service';
    const suffix = createHash('sha256').update(String(serviceId)).digest('hex').slice(0, 10);
    return `legacy-${normalized}-${suffix}`;
}

function buildLegacyMapping(service, migratedAt = new Date()) {
    const legacyServiceId = String(service.serviceId || '').trim();
    const providerServiceId = String(service.service || '').trim();
    const displayName = String(service.name || service.internalName || '').trim();
    if (!legacyServiceId) throw new Error('legacy serviceId is required');
    if (!providerServiceId) throw new Error('provider service ID is required');
    if (!displayName) throw new Error('service name is required');
    const min = positiveInteger(service.min, 'min');
    const max = positiveInteger(service.max, 'max');
    if (max < min) throw new Error('max must be greater than or equal to min');

    const provenance = { source: MIGRATION_SOURCE, sourceId: legacyServiceId, migratedAt };
    return {
        catalogue: {
            slug: legacySlug(legacyServiceId),
            displayName,
            platform: 'legacy',
            category: 'uncategorized',
            description: String(service.internalName || '').trim(),
            pricingUnit: 1000,
            min,
            max,
            markupOverrideBps: service.markupOverrideBps ?? null,
            refillPolicy: service.refill ? 'PROVIDER_SUPPORTED' : 'NONE',
            fulfilmentType: 'PROVIDER',
            active: true,
            visibility: 'ASSIGNED_ONLY',
            legacyServiceId,
            migrationProvenance: provenance,
        },
        offer: {
            providerServiceId,
            providerNameSnapshot: displayName,
            providerCategorySnapshot: '',
            providerDescriptionSnapshot: String(service.internalName || '').trim(),
            costRateMinor: majorToMinor(service.rate),
            pricingUnit: 1000,
            min,
            max,
            supportsRefill: Boolean(service.refill),
            availability: 'AVAILABLE',
            consecutiveMissingSyncs: 0,
            lastSeenAt: migratedAt,
            legacyServiceId,
            migrationProvenance: provenance,
        },
    };
}

async function ensureProvider(applyChanges) {
    const existing = await Provider.findOne({ code: PROVIDER_CODE });
    if (existing || !applyChanges) return existing;
    if (!process.env.API_URL || !process.env.API_KEY) {
        throw new Error('API_URL and API_KEY are required in apply mode');
    }
    const timeoutMs = positiveInteger(process.env.PROVIDER_TIMEOUT_MS || 15000, 'PROVIDER_TIMEOUT_MS');
    return Provider.create({
        code: PROVIDER_CODE,
        name: 'Legacy Primary Provider',
        adapterType: 'LEGACY_SMM',
        apiBaseUrl: process.env.API_URL,
        credentialReference: 'env:API_KEY',
        enabled: true,
        priority: 100,
        timeoutMs,
    });
}

async function applyMapping(service, mapping, provider, summary) {
    let catalogue = await CatalogueService.findOne({ legacyServiceId: mapping.catalogue.legacyServiceId });
    const existingOffer = await ProviderOffer.findOne({
        providerId: provider._id,
        providerServiceId: mapping.offer.providerServiceId,
    });

    if (service.catalogueServiceId && (!catalogue || !service.catalogueServiceId.equals(catalogue._id))) {
        throw new Error('legacy service already points to a different catalogue service');
    }
    if (existingOffer?.catalogueServiceId && (!catalogue ||
        !existingOffer.catalogueServiceId.equals(catalogue._id))) {
        throw new Error('provider offer already points to a different catalogue service');
    }
    if (!catalogue) catalogue = await CatalogueService.create(mapping.catalogue);

    if (!existingOffer) {
        await ProviderOffer.create({
            ...mapping.offer,
            providerId: provider._id,
            catalogueServiceId: catalogue._id,
        });
        summary.offersCreated += 1;
    } else if (!existingOffer.catalogueServiceId) {
        existingOffer.catalogueServiceId = catalogue._id;
        await existingOffer.save();
        summary.offersLinked += 1;
    }

    if (!service.catalogueServiceId) {
        service.catalogueServiceId = catalogue._id;
        service.catalogueMigration = {
            source: MIGRATION_SOURCE,
            migratedAt: mapping.catalogue.migrationProvenance.migratedAt,
        };
        await service.save();
        summary.servicesLinked += 1;
    }
    summary.applied += 1;
}

async function run() {
    const applyChanges = process.argv.includes('--apply');
    await connectToDatabase();
    const services = await Service.find({});
    const provider = await ensureProvider(applyChanges);
    const summary = {
        mode: applyChanges ? 'apply' : 'dry-run',
        provider: provider?.code || `${PROVIDER_CODE} (would create)`,
        scanned: services.length,
        valid: 0,
        invalid: 0,
        conflicts: 0,
        applied: 0,
        offersCreated: 0,
        offersLinked: 0,
        servicesLinked: 0,
    };

    for (const service of services) {
        try {
            const mapping = buildLegacyMapping(service);
            summary.valid += 1;
            if (applyChanges) await applyMapping(service, mapping, provider, summary);
        } catch (error) {
            const isConflict = /already points/.test(error.message);
            summary[isConflict ? 'conflicts' : 'invalid'] += 1;
            console.error(`Skipping service ${service.serviceId || service._id}: ${error.message}`);
        }
    }
    console.log(JSON.stringify(summary, null, 2));
    if (summary.invalid || summary.conflicts) process.exitCode = 2;
}

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(async () => disconnectFromDatabase());
}

module.exports = { buildLegacyMapping, legacySlug };
