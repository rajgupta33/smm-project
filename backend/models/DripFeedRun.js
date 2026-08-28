const mongoose = require('mongoose');

const positiveInteger = { type: Number, required: true, min: 1, validate: Number.isSafeInteger };
const nonNegativeInteger = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };

const DripFeedAttemptSchema = new mongoose.Schema({
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

const DripFeedRunSchema = new mongoose.Schema({
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DripFeedOrder',
        required: true,
        immutable: true,
    },
    runNumber: { ...positiveInteger, immutable: true },
    quantity: { ...positiveInteger, immutable: true },
    scheduledAt: {
        type: Date,
        required: true,
        immutable: true,
    },
    providerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Provider',
        default: null,
        immutable: true,
    },
    providerOfferId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProviderOffer',
        default: null,
        immutable: true,
    },
    providerOrderId: {
        type: String,
        default: null
    },
    allocatedAmountMinor: { ...positiveInteger, immutable: true },
    pricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    status: {
        type: String,
        enum: ['SCHEDULED', 'SUBMITTING', 'SUBMITTED', 'REJECTED', 'RECONCILIATION_REQUIRED', 'CANCELLED'],
        default: 'SCHEDULED'
    },
    attemptCount: { ...nonNegativeInteger, default: 0, max: 1 },
    attempt: { type: DripFeedAttemptSchema, default: null },
}, { timestamps: true });

DripFeedRunSchema.index({ parentId: 1, runNumber: 1 }, { unique: true });
DripFeedRunSchema.index(
    { providerId: 1, providerOrderId: 1 },
    { unique: true, partialFilterExpression: { providerOrderId: { $type: 'string' } } }
);
DripFeedRunSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('DripFeedRun', DripFeedRunSchema);

