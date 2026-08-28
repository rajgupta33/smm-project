const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const CatalogueService = require('../models/CatalogueService');
const Provider = require('../models/Provider');
const ProviderOffer = require('../models/ProviderOffer');
const ProviderSyncRun = require('../models/ProviderSyncRun');
const {
    createDispatch,
    dispatchByJobKey,
    providerSyncDispatchDocument,
} = require('../services/jobDispatchService');
const { resolveCredentialReference } = require('../providers/providerRegistry');
const { applyProviderSyncReport } = require('../services/providerSyncService');

function safeLimit(value, fallback = 100) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : fallback;
}

function requestIdFor(req) {
    return req.get('X-Request-Id')?.slice(0, 200) || randomUUID();
}

function safeProvider(provider) {
    const value = typeof provider?.toObject === 'function' ? provider.toObject() : { ...provider };
    if (!value) return null;
    delete value.credentialReference;
    return {
        ...value,
        credentialConfigured: Boolean(provider?.credentialReference),
    };
}

function providerPayload(body, { partial = false } = {}) {
    const allowed = ['code', 'name', 'adapterType', 'apiBaseUrl', 'credentialReference', 'enabled', 'priority', 'timeoutMs'];
    const payload = Object.fromEntries(allowed
        .filter((field) => body[field] !== undefined)
        .map((field) => [field, body[field]]));
    if (!partial) {
        for (const required of ['code', 'name', 'adapterType', 'apiBaseUrl', 'credentialReference']) {
            if (payload[required] === undefined) {
                const error = new Error(`${required} is required`);
                error.statusCode = 400;
                error.code = 'INVALID_PROVIDER';
                throw error;
            }
        }
    }
    return payload;
}

async function validateAssignedProvider(catalogue, providerId, role) {
    if (!mongoose.isValidObjectId(providerId)) {
        const error = new Error(`${role} provider ID is invalid`);
        error.statusCode = 400;
        error.code = 'INVALID_PROVIDER_ID';
        throw error;
    }
    const [provider, offer] = await Promise.all([
        Provider.findById(providerId),
        ProviderOffer.findOne({
            providerId,
            catalogueServiceId: catalogue._id,
            availability: 'AVAILABLE',
            min: { $lte: catalogue.min },
            max: { $gte: catalogue.max },
            pricingUnit: catalogue.pricingUnit,
        }),
    ]);
    if (!provider || !provider.enabled) {
        const error = new Error(`${role} provider must exist and be enabled`);
        error.statusCode = 409;
        error.code = 'PROVIDER_UNAVAILABLE';
        throw error;
    }
    if (!offer) {
        const error = new Error(`${role} provider needs an available offer covering the catalogue range`);
        error.statusCode = 409;
        error.code = 'PROVIDER_OFFER_INELIGIBLE';
        throw error;
    }
}

async function respondWithQueuedRun(res, run) {
    const dispatch = await dispatchByJobKey(
        providerSyncDispatchDocument(run._id).jobKey
    ).catch(() => ({ dispatched: false }));
    return res.status(202).json({
        success: true,
        data: {
            runId: run._id,
            mode: run.mode,
            status: run.status,
            queueDispatchPending: run.status === 'QUEUED' && dispatch.dispatchStatus !== 'ENQUEUED',
        },
    });
}

class CatalogueController {
    
    async updateCatalogueService(req, res) {
        try {
            const { serviceId } = req.params;
            const { routingStrategy, primaryProviderId, fallbackProviderId } = req.body;
            if (!mongoose.isValidObjectId(serviceId)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_CATALOGUE_ID', message: 'Catalogue service ID is invalid' } });
            }
            if (routingStrategy && routingStrategy !== 'MANUAL_PRIORITY') {
                return res.status(400).json({ success: false, error: { code: 'ROUTING_STRATEGY_NOT_ENABLED', message: 'Only manual-priority routing is enabled' } });
            }
            const service = await CatalogueService.findById(serviceId);
            if (!service) {
                return res.status(404).json({ success: false, error: { message: 'Catalogue service not found' } });
            }
            const nextPrimary = primaryProviderId !== undefined ? primaryProviderId : service.primaryProviderId;
            const nextFallback = fallbackProviderId !== undefined ? fallbackProviderId : service.fallbackProviderId;
            if (nextPrimary && nextFallback && String(nextPrimary) === String(nextFallback)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_PROVIDER_PRIORITY', message: 'Primary and fallback providers must be different' } });
            }
            if (service.fulfilmentType === 'PROVIDER' && !nextPrimary) {
                return res.status(400).json({ success: false, error: { code: 'PRIMARY_PROVIDER_REQUIRED', message: 'Provider services require a primary provider' } });
            }
            if (nextPrimary) await validateAssignedProvider(service, nextPrimary, 'Primary');
            if (nextFallback) await validateAssignedProvider(service, nextFallback, 'Fallback');

            const before = {
                routingStrategy: service.routingStrategy,
                primaryProviderId: service.primaryProviderId,
                fallbackProviderId: service.fallbackProviderId,
            };
            service.routingStrategy = 'MANUAL_PRIORITY';
            service.primaryProviderId = nextPrimary || null;
            service.fallbackProviderId = nextFallback || null;
            await service.save();
            await AuditLog.create({
                action: 'CATALOGUE_ROUTING_UPDATED',
                actorType: 'ADMIN',
                actorId: req.currentUser._id,
                targetType: 'CatalogueService',
                targetId: String(service._id),
                requestId: requestIdFor(req),
                before,
                after: {
                    routingStrategy: service.routingStrategy,
                    primaryProviderId: service.primaryProviderId,
                    fallbackProviderId: service.fallbackProviderId,
                },
            });
            res.status(200).json({ success: true, data: service });
        } catch (error) {
            console.error('Error updating catalogue service:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                error: {
                    code: error.code || 'CATALOGUE_UPDATE_FAILED',
                    message: error.statusCode ? error.message : 'Failed to update catalogue service',
                },
            });
        }
    }

    async createProvider(req, res) {
        try {
            const payload = providerPayload(req.body);
            const provider = new Provider(payload);
            await provider.validate();
            if (provider.enabled) resolveCredentialReference(provider.credentialReference);
            await provider.save();
            await AuditLog.create({
                action: 'PROVIDER_CREATED', actorType: 'ADMIN', actorId: req.currentUser._id,
                targetType: 'Provider', targetId: String(provider._id), requestId: requestIdFor(req),
                before: null, after: safeProvider(provider),
            });
            return res.status(201).json({ success: true, data: safeProvider(provider) });
        } catch (error) {
            const duplicate = error?.code === 11000;
            return res.status(error.statusCode || (duplicate ? 409 : 400)).json({
                success: false,
                error: {
                    code: duplicate ? 'PROVIDER_CODE_EXISTS' : error.code || 'INVALID_PROVIDER',
                    message: error.statusCode ? error.message : duplicate
                        ? 'Provider code already exists' : 'Provider configuration is invalid',
                },
            });
        }
    }

    async updateProvider(req, res) {
        try {
            if (!mongoose.isValidObjectId(req.params.providerId)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_PROVIDER_ID', message: 'Provider ID is invalid' } });
            }
            const provider = await Provider.findById(req.params.providerId).select('+credentialReference');
            if (!provider) return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' } });
            const before = safeProvider(provider);
            const payload = providerPayload(req.body, { partial: true });
            for (const [field, value] of Object.entries(payload)) provider[field] = value;
            await provider.validate();
            if (provider.enabled) resolveCredentialReference(provider.credentialReference);
            await provider.save();
            const after = safeProvider(provider);
            await AuditLog.create({
                action: 'PROVIDER_UPDATED', actorType: 'ADMIN', actorId: req.currentUser._id,
                targetType: 'Provider', targetId: String(provider._id), requestId: requestIdFor(req),
                before, after,
            });
            return res.json({ success: true, data: after });
        } catch (error) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: {
                    code: error.code || 'INVALID_PROVIDER',
                    message: error.statusCode ? error.message : 'Provider configuration is invalid',
                },
            });
        }
    }

    async getCatalogueServices(req, res) {
        try {
            const data = await CatalogueService.find({})
                .sort({ platform: 1, category: 1, displayName: 1 })
                .limit(safeLimit(req.query.limit))
                .lean();
            res.status(200).json({ success: true, data });
        } catch {
            res.status(500).json({ success: false, error: { code: 'CATALOGUE_READ_FAILED', message: 'Catalogue could not be loaded' } });
        }
    }

    async getProviders(req, res) {
        try {
            const data = await Provider.find({})
                .sort({ priority: 1, name: 1 })
                .limit(safeLimit(req.query.limit))
                .select('+credentialReference')
                .lean();
            res.status(200).json({ success: true, data: data.map(safeProvider) });
        } catch {
            res.status(500).json({ success: false, error: { code: 'PROVIDER_READ_FAILED', message: 'Providers could not be loaded' } });
        }
    }

    async getProviderOffers(req, res) {
        try {
            const filter = req.query.providerId ? { providerId: req.query.providerId } : {};
            const data = await ProviderOffer.find(filter)
                .sort({ providerId: 1, providerServiceId: 1 })
                .limit(safeLimit(req.query.limit))
                .lean();
            res.status(200).json({ success: true, data });
        } catch {
            res.status(400).json({ success: false, error: { code: 'INVALID_PROVIDER_FILTER', message: 'Provider offer filter is invalid' } });
        }
    }

    async createSyncReport(req, res) {
        const requestId = req.get('X-Request-Id')?.slice(0, 200) || randomUUID();
        let session;
        try {
            if (!mongoose.isValidObjectId(req.body.providerId)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_PROVIDER_ID', message: 'providerId is invalid' } });
            }
            const existingRun = await ProviderSyncRun.findOne({
                triggeredBy: req.currentUser._id,
                requestId,
            });
            if (existingRun) return respondWithQueuedRun(res, existingRun);

            session = await mongoose.startSession();
            let run;
            await session.withTransaction(async () => {
                const provider = await Provider.findById(req.body.providerId).session(session);
                if (!provider) {
                    const error = new Error('Provider not found');
                    error.code = 'PROVIDER_NOT_FOUND';
                    error.statusCode = 404;
                    throw error;
                }
                [run] = await ProviderSyncRun.create([{
                    providerId: provider._id,
                    mode: 'REPORT_ONLY',
                    status: 'QUEUED',
                    queuedAt: new Date(),
                    triggeredBy: req.currentUser._id,
                    requestId,
                }], { session });
                await createDispatch(providerSyncDispatchDocument(run._id), session);
            });
            return respondWithQueuedRun(res, run);
        } catch (error) {
            if (error.code === 11000) {
                const existingRun = await ProviderSyncRun.findOne({
                    triggeredBy: req.currentUser._id,
                    requestId,
                });
                if (existingRun) return respondWithQueuedRun(res, existingRun);
            }
            res.status(error.statusCode || 500).json({
                success: false,
                error: {
                    code: error.code || 'PROVIDER_SYNC_QUEUE_FAILED',
                    message: error.statusCode ? error.message : 'Provider synchronization could not be queued',
                },
            });
        } finally {
            if (session) await session.endSession();
        }
    }

    async getSyncRuns(req, res) {
        try {
            const filter = req.query.providerId ? { providerId: req.query.providerId } : {};
            const data = await ProviderSyncRun.find(filter)
                .sort({ createdAt: -1 })
                .limit(safeLimit(req.query.limit, 25))
                .select('-report')
                .lean();
            res.status(200).json({ success: true, data });
        } catch {
            res.status(400).json({ success: false, error: { code: 'INVALID_PROVIDER_FILTER', message: 'Provider sync filter is invalid' } });
        }
    }

    async getSyncRun(req, res) {
        try {
            if (!mongoose.isValidObjectId(req.params.runId)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_SYNC_RUN_ID', message: 'Synchronization run ID is invalid' } });
            }
            const run = await ProviderSyncRun.findById(req.params.runId).lean();
            if (!run) {
                return res.status(404).json({ success: false, error: { code: 'SYNC_REPORT_NOT_FOUND', message: 'Synchronization report not found' } });
            }
            return res.json({ success: true, data: run });
        } catch {
            return res.status(500).json({ success: false, error: { code: 'SYNC_REPORT_READ_FAILED', message: 'Synchronization report could not be loaded' } });
        }
    }

    async applySyncRun(req, res) {
        try {
            const result = await applyProviderSyncReport({
                runId: req.params.runId,
                actorId: req.currentUser._id,
                requestId: requestIdFor(req),
                catalogueMappings: req.body?.catalogueMappings || [],
            });
            return res.status(200).json({
                success: true,
                idempotentReplay: result.idempotentReplay,
                data: {
                    runId: result.run._id,
                    applicationStatus: result.run.applicationStatus,
                    appliedAt: result.run.appliedAt,
                    applyCounts: result.run.applyCounts,
                },
            });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                success: false,
                error: {
                    code: error.code || 'SYNC_REPORT_APPLY_FAILED',
                    message: error.statusCode ? error.message : 'Synchronization report could not be applied',
                },
            });
        }
    }
}

module.exports = new CatalogueController();
