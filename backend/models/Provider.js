const mongoose = require('mongoose');

const nullableSafeInteger = {
    validator: (value) => value === null || value === undefined || Number.isSafeInteger(value),
    message: '{PATH} must be a safe integer',
};

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
    balanceMonitoringEnabled: { type: Boolean, default: true, required: true },
    // Paise. Null disables the fixed-amount check; the spend-runway check still applies.
    lowBalanceWarningMinor: { type: Number, default: 200000, min: 0, validate: nullableSafeInteger },
    lowBalanceCriticalMinor: { type: Number, default: 50000, min: 0, validate: nullableSafeInteger },
    balanceSnapshot: {
        balanceMinor: { type: Number, default: null, validate: nullableSafeInteger },
        currency: { type: String, default: null, trim: true },
        checkedAt: { type: Date, default: null },
        avgDailySpendMinor: { type: Number, default: null, validate: nullableSafeInteger },
        runwayHours: { type: Number, default: null, validate: nullableSafeInteger },
        level: { type: String, enum: ['OK', 'WARNING', 'CRITICAL'], default: null },
    },
    balanceCheckFailures: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    balanceCheckError: {
        type: new mongoose.Schema({
            code: { type: String, required: true },
            message: { type: String, required: true },
            at: { type: Date, required: true },
        }, { _id: false }),
        default: null,
    },
}, { timestamps: true });

ProviderSchema.path('lowBalanceCriticalMinor').validate(function validateCriticalThreshold(value) {
    if (value === null || value === undefined) return true;
    if (this.lowBalanceWarningMinor === null || this.lowBalanceWarningMinor === undefined) return true;
    return value <= this.lowBalanceWarningMinor;
}, 'lowBalanceCriticalMinor must not exceed lowBalanceWarningMinor');

ProviderSchema.index({ enabled: 1, priority: 1 });

module.exports = mongoose.model('Provider', ProviderSchema);
