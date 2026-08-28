const mongoose = require('mongoose');

const ProviderSyncRunSchema = new mongoose.Schema({
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    mode: { type: String, enum: ['REPORT_ONLY'], default: 'REPORT_ONLY', required: true },
    status: { type: String, enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'], required: true },
    queuedAt: { type: Date, required: true, default: Date.now },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestId: { type: String, required: true, trim: true },
    counts: {
        fetched: { type: Number, default: 0 },
        existing: { type: Number, default: 0 },
        new: { type: Number, default: 0 },
        changed: { type: Number, default: 0 },
        missing: { type: Number, default: 0 },
        invalid: { type: Number, default: 0 },
    },
    report: { type: mongoose.Schema.Types.Mixed, default: null },
    errorCode: { type: String, default: null },
    applicationStatus: {
        type: String,
        enum: ['PENDING', 'APPLIED'],
        default: 'PENDING',
        required: true,
    },
    appliedAt: { type: Date, default: null },
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    applyRequestId: { type: String, trim: true, default: null },
    applyCounts: {
        inserted: { type: Number, default: 0 },
        updated: { type: Number, default: 0 },
        seen: { type: Number, default: 0 },
        missing: { type: Number, default: 0 },
        mapped: { type: Number, default: 0 },
    },
}, { timestamps: true });

ProviderSyncRunSchema.index({ providerId: 1, startedAt: -1 });
ProviderSyncRunSchema.index({ providerId: 1, createdAt: -1 });
ProviderSyncRunSchema.index({ status: 1, startedAt: -1 });
ProviderSyncRunSchema.index({ triggeredBy: 1, requestId: 1 }, { unique: true });
ProviderSyncRunSchema.index(
    { appliedBy: 1, applyRequestId: 1 },
    {
        unique: true,
        partialFilterExpression: { applyRequestId: { $type: 'string' } },
    }
);

module.exports = mongoose.model('ProviderSyncRun', ProviderSyncRunSchema);
