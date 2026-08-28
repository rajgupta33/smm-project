const mongoose = require('mongoose');

const safeInteger = {
    validator: Number.isSafeInteger,
    message: '{PATH} must be a safe integer',
};

const ProviderOfferSchema = new mongoose.Schema({
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    providerServiceId: { type: String, required: true, trim: true },
    catalogueServiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CatalogueService',
        default: null,
    },
    providerNameSnapshot: { type: String, required: true, trim: true },
    providerCategorySnapshot: { type: String, default: '', trim: true },
    providerDescriptionSnapshot: { type: String, default: '', trim: true },
    costRateMinor: { type: Number, required: true, min: 0, validate: safeInteger },
    pricingUnit: { type: Number, required: true, default: 1000, min: 1, validate: safeInteger },
    min: { type: Number, required: true, min: 1, validate: safeInteger },
    max: { type: Number, required: true, min: 1, validate: safeInteger },
    supportsRefill: { type: Boolean, default: false, required: true },
    availability: {
        type: String,
        enum: ['AVAILABLE', 'SUSPECTED_UNAVAILABLE', 'UNAVAILABLE'],
        default: 'AVAILABLE',
        required: true,
    },
    consecutiveMissingSyncs: { type: Number, default: 0, min: 0, validate: safeInteger },
    lastSeenAt: { type: Date, required: true },
    qualityScore: { type: Number, default: null, min: 0, max: 100 },
    legacyServiceId: { type: String, trim: true, default: undefined },
    migrationProvenance: {
        source: { type: String, default: null },
        sourceId: { type: String, default: null },
        migratedAt: { type: Date, default: null },
    },
}, { timestamps: true });

ProviderOfferSchema.path('max').validate(function validateMaximum(value) {
    return !Number.isSafeInteger(this.min) || value >= this.min;
}, 'max must be greater than or equal to min');

ProviderOfferSchema.index({ providerId: 1, providerServiceId: 1 }, { unique: true });
ProviderOfferSchema.index({ catalogueServiceId: 1, availability: 1 });
ProviderOfferSchema.index({ providerId: 1, availability: 1, lastSeenAt: -1 });
ProviderOfferSchema.index({ legacyServiceId: 1 }, { sparse: true });

module.exports = mongoose.model('ProviderOffer', ProviderOfferSchema);
