const Provider = require('../models/Provider');
const ProviderOffer = require('../models/ProviderOffer');
const CatalogueService = require('../models/CatalogueService');
const { createProviderSyncReport } = require('./providerSyncService');
const { raiseAlert, resolveAlert } = require('./adminAlertService');

const ANOMALY_MISSING_RATIO = 0.3;

const alertKeys = {
    removed: (catalogueServiceId) => `service-removed:${catalogueServiceId}`,
    offerRemoved: (offerId) => `service-offer-removed:${offerId}`,
    reappeared: (offerId) => `service-reappeared:${offerId}`,
    syncAnomaly: (providerId) => `provider-sync-anomaly:${providerId}`,
};

function dependencies(overrides = {}) {
    return {
        Provider,
        ProviderOffer,
        CatalogueService,
        createProviderSyncReport,
        raiseAlert,
        resolveAlert,
        ...overrides,
    };
}

/**
 * Guards against treating a broken provider feed as mass service removal.
 * A provider returning nothing, or losing more than 30% of its known offers
 * in one check, is far more likely an outage than every one of those
 * services vanishing at once.
 */
function classifyReportAnomaly(report) {
    if (report.counts.fetched === 0) {
        return { anomalous: true, reason: 'PROVIDER_RETURNED_NO_SERVICES' };
    }
    if (report.counts.existing > 0) {
        const missingRatio = report.counts.missing / report.counts.existing;
        if (missingRatio > ANOMALY_MISSING_RATIO) {
            return { anomalous: true, reason: 'TOO_MANY_SERVICES_MISSING_AT_ONCE', missingRatio };
        }
    }
    return { anomalous: false };
}

async function handleAnomaly(provider, anomaly, now, deps) {
    const providerKey = String(provider._id);
    const message = anomaly.reason === 'PROVIDER_RETURNED_NO_SERVICES'
        ? `${provider.name} returned zero services on this check. This looks like a provider outage, not mass removal, so no service was changed or hidden.`
        : `${provider.name} lost ${Math.round(anomaly.missingRatio * 100)}% of its known services in one check. This looks like a provider outage, not mass removal, so nothing was changed or hidden.`;
    await deps.raiseAlert({
        type: 'PROVIDER_SYNC_ANOMALY',
        severity: 'WARNING',
        dedupeKey: alertKeys.syncAnomaly(providerKey),
        title: `${provider.name} availability check looks abnormal`,
        message,
        targetType: 'Provider',
        targetId: providerKey,
        metadata: { reason: anomaly.reason, missingRatio: anomaly.missingRatio ?? null },
        now,
    });
}

/** Applies only the availability transition for one offer already known to be missing. */
async function applyMissingOffer(provider, missing, now, deps) {
    const offer = await deps.ProviderOffer.findOne({
        providerId: provider._id,
        providerServiceId: missing.providerServiceId,
    });
    if (!offer) return null;

    await deps.ProviderOffer.updateOne(
        { _id: offer._id },
        { $set: { availability: missing.proposedAvailability, consecutiveMissingSyncs: missing.consecutiveMissingSyncs } }
    );

    // Unmapped provider offers are not sold to customers; keep their state accurate but stay quiet.
    if (missing.proposedAvailability !== 'UNAVAILABLE' || !offer.catalogueServiceId) return null;

    const catalogue = await deps.CatalogueService.findById(offer.catalogueServiceId);
    if (!catalogue) return null;

    const hasOtherAvailableOffer = await deps.ProviderOffer.exists({
        catalogueServiceId: catalogue._id,
        availability: 'AVAILABLE',
        _id: { $ne: offer._id },
    });

    if (hasOtherAvailableOffer) {
        await deps.raiseAlert({
            type: 'SERVICE_OFFER_REMOVED',
            severity: 'WARNING',
            dedupeKey: alertKeys.offerRemoved(String(offer._id)),
            title: `A provider offer for ${catalogue.displayName} was removed`,
            message: `${provider.name} no longer lists "${offer.providerNameSnapshot}" (provider service ${offer.providerServiceId}). ${catalogue.displayName} is still on sale because another provider offer covers it — check whether it should stay the primary provider.`,
            targetType: 'CatalogueService',
            targetId: String(catalogue._id),
            metadata: { providerId: String(provider._id), providerServiceId: offer.providerServiceId },
            now,
        });
        return { catalogueHidden: false };
    }

    const alreadyAutoHidden = Boolean(catalogue.autoHiddenAt);
    if (!alreadyAutoHidden) {
        await deps.CatalogueService.updateOne(
            { _id: catalogue._id },
            {
                $set: {
                    active: false,
                    autoHiddenAt: now,
                    autoHiddenReason: `Provider offer ${offer.providerServiceId} on ${provider.name} was confirmed removed with no other offer available.`,
                },
            }
        );
    }
    await deps.raiseAlert({
        type: 'SERVICE_REMOVED',
        severity: 'CRITICAL',
        dedupeKey: alertKeys.removed(String(catalogue._id)),
        title: `${catalogue.displayName} was removed from ${provider.name} and hidden`,
        message: `${provider.name} no longer lists "${offer.providerNameSnapshot}" (provider service ${offer.providerServiceId}) and no other provider offer covers ${catalogue.displayName}. It has been hidden from customers and can no longer be ordered. Reactivate it once you have confirmed a working provider offer.`,
        targetType: 'CatalogueService',
        targetId: String(catalogue._id),
        metadata: { providerId: String(provider._id), providerServiceId: offer.providerServiceId },
        now,
    });
    return { catalogueHidden: true };
}

/** Applies only the availability transition for an offer the provider is listing again. */
async function applyReappearedOffer(provider, change, now, deps) {
    const offer = await deps.ProviderOffer.findOne({
        providerId: provider._id,
        providerServiceId: change.providerServiceId,
    });
    if (!offer || offer.availability === 'AVAILABLE') return null;

    await deps.ProviderOffer.updateOne(
        { _id: offer._id },
        { $set: { availability: 'AVAILABLE', consecutiveMissingSyncs: 0, lastSeenAt: now } }
    );
    await deps.resolveAlert({ dedupeKey: alertKeys.offerRemoved(String(offer._id)), now });
    if (!offer.catalogueServiceId) return null;

    const catalogue = await deps.CatalogueService.findById(offer.catalogueServiceId);
    if (!catalogue) return null;
    await deps.resolveAlert({ dedupeKey: alertKeys.removed(String(catalogue._id)), now });

    if (catalogue.autoHiddenAt) {
        await deps.raiseAlert({
            type: 'SERVICE_REAPPEARED',
            severity: 'INFO',
            dedupeKey: alertKeys.reappeared(String(offer._id)),
            title: `${catalogue.displayName} is available from ${provider.name} again`,
            message: `${provider.name} is listing "${offer.providerNameSnapshot}" again. ${catalogue.displayName} stays hidden from customers until you reactivate it, so review the offer before turning it back on.`,
            targetType: 'CatalogueService',
            targetId: String(catalogue._id),
            metadata: { providerId: String(provider._id), providerServiceId: offer.providerServiceId },
            now,
        });
    }
    return { reappeared: true };
}

async function scanProviderAvailability(provider, options, deps) {
    const now = options.now || new Date();
    const report = await deps.createProviderSyncReport(provider);
    const anomaly = classifyReportAnomaly(report);
    if (anomaly.anomalous) {
        await handleAnomaly(provider, anomaly, now, deps);
        return { providerId: String(provider._id), status: 'ANOMALOUS', reason: anomaly.reason };
    }
    await deps.resolveAlert({ dedupeKey: alertKeys.syncAnomaly(String(provider._id)), now });

    const counts = { removed: 0, offerRemoved: 0, reappeared: 0 };
    for (const missing of report.missing) {
        const result = await applyMissingOffer(provider, missing, now, deps);
        if (result?.catalogueHidden) counts.removed += 1;
        else if (result && result.catalogueHidden === false) counts.offerRemoved += 1;
    }
    for (const change of report.changed) {
        if (!change.fields.includes('availability') || change.after?.availability !== 'AVAILABLE') continue;
        const result = await applyReappearedOffer(provider, change, now, deps);
        if (result?.reappeared) counts.reappeared += 1;
    }
    return { providerId: String(provider._id), status: 'CHECKED', counts };
}

async function scanServiceAvailability(options = {}) {
    const deps = dependencies(options.overrides);
    const now = options.now || new Date();
    let query = deps.Provider.find({ enabled: true });
    if (typeof query?.select === 'function') query = query.select('+credentialReference');
    const providers = await query;

    const results = [];
    for (const provider of providers) {
        try {
            results.push(await scanProviderAvailability(provider, { now }, deps));
        } catch (error) {
            console.error(`Service availability check failed for provider ${provider._id}:`, error.message);
            results.push({ providerId: String(provider._id), status: 'ERROR', code: error.code || 'AVAILABILITY_SCAN_FAILED' });
        }
    }
    const totals = { scanned: providers.length, checked: 0, anomalous: 0, failed: 0, removed: 0, offerRemoved: 0, reappeared: 0 };
    for (const result of results) {
        if (result.status === 'CHECKED') {
            totals.checked += 1;
            totals.removed += result.counts.removed;
            totals.offerRemoved += result.counts.offerRemoved;
            totals.reappeared += result.counts.reappeared;
        } else if (result.status === 'ANOMALOUS') totals.anomalous += 1;
        else totals.failed += 1;
    }
    return { totals, results };
}

module.exports = {
    ANOMALY_MISSING_RATIO,
    alertKeys,
    classifyReportAnomaly,
    scanServiceAvailability,
};
