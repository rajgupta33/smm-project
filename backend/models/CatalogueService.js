const mongoose = require('mongoose');

const integer = {
    validator: Number.isSafeInteger,
    message: '{PATH} must be a safe integer',
};

const CatalogueServiceSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    platform: { type: String, required: true, trim: true, default: 'other' },
    category: { type: String, required: true, trim: true, default: 'other' },
    description: { type: String, default: '', trim: true },
    pricingUnit: { type: Number, required: true, default: 1000, min: 1, validate: integer },
    min: { type: Number, required: true, min: 1, validate: integer },
    max: { type: Number, required: true, min: 1, validate: integer },
    markupOverrideBps: {
        type: Number,
        default: null,
        min: 0,
        validate: {
            validator: (value) => value === null || Number.isSafeInteger(value),
            message: 'markupOverrideBps must be integer basis points',
        },
    },
    refillPolicy: {
        type: String,
        enum: ['NONE', 'PROVIDER_SUPPORTED'],
        default: 'NONE',
        required: true,
    },
    fulfilmentType: {
        type: String,
        enum: ['PROVIDER', 'MANUAL', 'CUSTOM_AUTOMATION'],
        default: 'PROVIDER',
        required: true,
    },
    routingStrategy: {
        type: String,
        enum: ['MANUAL_PRIORITY', 'COST_AWARE', 'QUALITY_AWARE'],
        default: 'MANUAL_PRIORITY',
        required: true,
    },
    primaryProviderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Provider',
        default: null,
    },
    fallbackProviderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Provider',
        default: null,
    },
    active: { type: Boolean, default: true, required: true },
    visibility: {
        type: String,
        enum: ['PUBLIC', 'ASSIGNED_ONLY', 'HIDDEN'],
        default: 'ASSIGNED_ONLY',
        required: true,
    },
    legacyServiceId: { type: String, trim: true, default: undefined },
    migrationProvenance: {
        source: { type: String, default: null },
        sourceId: { type: String, default: null },
        migratedAt: { type: Date, default: null },
    },
}, { timestamps: true });

CatalogueServiceSchema.path('max').validate(function validateMaximum(value) {
    return !Number.isSafeInteger(this.min) || value >= this.min;
}, 'max must be greater than or equal to min');

CatalogueServiceSchema.index({ legacyServiceId: 1 }, { unique: true, sparse: true });
CatalogueServiceSchema.index({ active: 1, visibility: 1, platform: 1, category: 1 });

module.exports = mongoose.model('CatalogueService', CatalogueServiceSchema);
