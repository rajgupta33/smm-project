const mongoose = require('mongoose');

const nonNegativeInteger = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const positiveInteger = { type: Number, required: true, min: 1, validate: Number.isSafeInteger };

const PricingSnapshotSchema = new mongoose.Schema({
    providerCostRateMinor: nonNegativeInteger,
    sellingRateMinor: nonNegativeInteger,
    markupBps: nonNegativeInteger,
    pricingUnit: positiveInteger,
    quantity: positiveInteger,
    providerCostTotalMinor: nonNegativeInteger,
    sellingTotalMinor: nonNegativeInteger,
    grossSpreadMinor: nonNegativeInteger,
    currency: { type: String, enum: ['INR'], required: true },
    pricingVersion: positiveInteger,
    pricedAt: { type: Date, required: true },
}, { _id: false });

const SubmissionAttemptSchema = new mongoose.Schema({
    attemptNumber: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    outcome: {
        type: String,
        enum: ['STARTED', 'ACCEPTED', 'DEFINITIVE_REJECTION', 'AMBIGUOUS'],
        required: true,
    },
    failureKind: {
        type: String,
        enum: ['PROVIDER_REJECTION', 'PROVIDER_CONFIGURATION', 'TIMEOUT', 'TRANSPORT', 'HTTP_5XX', 'MALFORMED_RESPONSE', 'PERSISTENCE_FAILURE', 'INTERRUPTED_ATTEMPT', 'RECONCILED_NOT_ACCEPTED'],
        default: null,
    },
    httpStatus: { type: Number, default: null },
    responseSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: null },
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    localOrderId: {
        type: String,
        trim: true,
        immutable: true,
    },
    idempotencyKey: {
        type: String,
        trim: true,
    },
    orderId: {
        type: String,
        required: true,
        unique: true
    },
    lastStatus: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true
    },
    rate: {
        type: Number,
        required: true
    },
    lifecycleStatus: {
        type: String,
        enum: ['INTENT_COMMITTED', 'SUBMITTING', 'SUBMITTED', 'PROVIDER_REJECTED', 'RECONCILIATION_REQUIRED', 'MANUAL_PROCESSING', 'COMPLETED', 'CANCELLED', 'DRIP_FEED'],
        default: 'SUBMITTED',
        required: true,
    },
    fundingStatus: {
        type: String,
        enum: ['DEBITED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
        default: 'DEBITED',
        required: true,
    },
    providerOrderId: {
        type: String,
        trim: true,
        default: undefined,
    },
    providerServiceId: {
        type: String,
        trim: true,
        immutable: true,
        default: null,
    },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', default: null },
    providerOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderOffer', default: null },
    catalogueServiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogueService', default: null },
    refillGuaranteeUntil: { type: Date, default: null },
    target: {
        type: String,
        immutable: true,
        default: null,
    },
    submissionAttempt: {
        type: SubmissionAttemptSchema,
        default: null,
    },
    reconciliationReason: {
        type: String,
        default: null,
    },
    reconciliationRequiredAt: {
        type: Date,
        default: null,
    },
    lastOrderStatusCheckAt: {
        type: Date,
        default: null,
    },
    nextOrderStatusCheckAt: {
        type: Date,
        default: null,
    },
    pricingSnapshot: {
        type: PricingSnapshotSchema,
        default: null,
        immutable: true,
    },
    service: {
        type: String,
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    refill: {
        type: String,
        default: null
    },
    start_count: {
        type: String,
    }
}, { timestamps: true });

OrderSchema.index({ user: 1 }); 
OrderSchema.index({ user: 1, createdAt: -1 }); 
OrderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
OrderSchema.index({ localOrderId: 1 }, { unique: true, sparse: true });
OrderSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true });
OrderSchema.index({ lifecycleStatus: 1, updatedAt: 1 });
OrderSchema.index({ providerId: 1, providerOrderId: 1 });
OrderSchema.index({ lifecycleStatus: 1, nextOrderStatusCheckAt: 1 });
module.exports = mongoose.model('Order', OrderSchema);
