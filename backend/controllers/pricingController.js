const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const PricingSettings = require('../models/PricingSettings');
const Service = require('../models/Service');
const {
    PricingError,
    getMaxMarkupBps,
    getPricingSettings,
    majorToMinor,
    calculateSellingRate,
    validateMarkupBps,
} = require('../services/pricingService');

function serializeSettings(settings) {
    return {
        globalMarkupBps: settings.globalMarkupBps,
        currency: settings.currency,
        pricingUnit: settings.pricingUnit,
        minimumMarginBps: settings.minimumMarginBps,
        version: settings.version,
        maxMarkupBps: getMaxMarkupBps(),
        updatedAt: settings.updatedAt,
    };
}

function requestIdFor(req) {
    const supplied = req.get('X-Request-Id');
    return typeof supplied === 'string' && supplied.trim() && supplied.length <= 200
        ? supplied.trim()
        : randomUUID();
}

class PricingController {
    async getSettings(req, res) {
        try {
            const settings = await getPricingSettings();
            res.status(200).json({ data: serializeSettings(settings) });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                error: error.message,
                code: error.code || 'PRICING_SETTINGS_FAILED',
            });
        }
    }

    async updateSettings(req, res) {
        let session;
        try {
            const { globalMarkupBps, minimumMarginBps = 0, expectedVersion } = req.body;
            validateMarkupBps(globalMarkupBps);
            validateMarkupBps(minimumMarginBps);
            if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
                throw new PricingError(
                    'expectedVersion must be a positive integer',
                    'INVALID_EXPECTED_VERSION'
                );
            }
            if (globalMarkupBps < minimumMarginBps) {
                throw new PricingError(
                    'globalMarkupBps cannot be below minimumMarginBps',
                    'MARKUP_BELOW_MINIMUM'
                );
            }

            const auditRequestId = requestIdFor(req);
            let updated;
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const current = await getPricingSettings({ session });
                if (current.version !== expectedVersion) {
                    throw new PricingError(
                        'Pricing settings changed; refresh and try again',
                        'PRICING_VERSION_CONFLICT',
                        409
                    );
                }
                const incompatibleService = await Service.findOne({
                    markupOverrideBps: { $ne: null, $lt: minimumMarginBps },
                }).select('serviceId markupOverrideBps').session(session).lean();
                if (incompatibleService) {
                    throw new PricingError(
                        `Service ${incompatibleService.serviceId} has an override below the proposed minimum margin`,
                        'SERVICE_OVERRIDE_BELOW_MINIMUM',
                        409
                    );
                }

                updated = await PricingSettings.findOneAndUpdate(
                    { key: 'global', version: expectedVersion },
                    {
                        $set: {
                            globalMarkupBps,
                            minimumMarginBps,
                            updatedBy: req.currentUser._id,
                        },
                        $inc: { version: 1 },
                    },
                    { new: true, runValidators: true, session }
                );
                if (!updated) {
                    throw new PricingError(
                        'Pricing settings changed; refresh and try again',
                        'PRICING_VERSION_CONFLICT',
                        409
                    );
                }

                await AuditLog.create([{
                    action: 'PRICING_SETTINGS_UPDATED',
                    actorType: 'ADMIN',
                    actorId: req.currentUser._id,
                    targetType: 'PricingSettings',
                    targetId: 'global',
                    requestId: auditRequestId,
                    before: serializeSettings(current),
                    after: serializeSettings(updated),
                }], { session });
            });

            res.status(200).json({ data: serializeSettings(updated) });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                error: error.message,
                code: error.code || 'PRICING_UPDATE_FAILED',
            });
        } finally {
            if (session) await session.endSession();
        }
    }

    async preview(req, res) {
        try {
            const { providerRate, markupBps } = req.body;
            validateMarkupBps(markupBps);
            const settings = await getPricingSettings();
            const providerRateMinor = majorToMinor(providerRate);
            const sellingRateMinor = calculateSellingRate(providerRateMinor, markupBps);
            res.status(200).json({
                data: {
                    sellingRateMinor,
                    sellingRate: sellingRateMinor / 100,
                    currency: settings.currency,
                    pricingUnit: settings.pricingUnit,
                },
            });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                error: error.message,
                code: error.code || 'PRICING_PREVIEW_FAILED',
            });
        }
    }

    async getHistory(req, res) {
        try {
            const requestedLimit = Number.parseInt(req.query.limit || '25', 10);
            const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
                ? Math.min(requestedLimit, 100)
                : 25;
            const history = await AuditLog.find({ action: 'PRICING_SETTINGS_UPDATED' })
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();
            res.status(200).json({ data: history });
        } catch (error) {
            res.status(500).json({ error: error.message, code: 'PRICING_HISTORY_FAILED' });
        }
    }
}

module.exports = new PricingController();
