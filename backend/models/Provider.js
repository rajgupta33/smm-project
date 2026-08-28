const mongoose = require('mongoose');

const ProviderSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    adapterType: {
        type: String,
        enum: ['LEGACY_SMM'],
        required: true,
    },
    apiBaseUrl: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator(value) {
                try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
            },
            message: 'apiBaseUrl must be an http or https URL',
        },
    },
    credentialReference: {
        type: String,
        required: true,
        trim: true,
        match: /^env:[A-Z][A-Z0-9_]*$/,
        select: false,
    },
    enabled: { type: Boolean, default: true, required: true },
    priority: { type: Number, default: 100, validate: Number.isSafeInteger },
    healthStatus: {
        type: String,
        enum: ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE'],
        default: 'UNKNOWN',
        required: true,
    },
    lastSuccessfulSyncAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
    requestCount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    successCount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    failureCount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    timeoutCount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    totalLatencyMs: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    qualityScore: { type: Number, default: 100, min: 0, max: 100, validate: Number.isSafeInteger },
    timeoutMs: { type: Number, default: 15000, min: 1, validate: Number.isSafeInteger },
}, { timestamps: true });

ProviderSchema.index({ enabled: 1, priority: 1 });

module.exports = mongoose.model('Provider', ProviderSchema);
