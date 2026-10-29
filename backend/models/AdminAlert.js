const mongoose = require('mongoose');

const AdminAlertSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: [
            'PROVIDER_LOW_BALANCE', 'PROVIDER_INSUFFICIENT_FUNDS', 'PROVIDER_BALANCE_CHECK_FAILED',
            'SERVICE_REMOVED', 'SERVICE_OFFER_REMOVED', 'SERVICE_REAPPEARED', 'PROVIDER_SYNC_ANOMALY',
        ],
        required: true,
    },
    severity: {
        type: String,
        enum: ['INFO', 'WARNING', 'CRITICAL'],
        required: true,
    },
    status: {
        type: String,
        enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
        default: 'OPEN',
        required: true,
    },
    // Unresolved alerts carry active=true. The partial unique index on dedupeKey
    // makes a recurring condition update one alert instead of opening duplicates.
    active: { type: Boolean, default: true, required: true },
    dedupeKey: { type: String, required: true, trim: true, maxlength: 300 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    targetType: { type: String, default: null, trim: true },
    targetId: { type: String, default: null, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    occurrences: { type: Number, default: 1, min: 1, validate: Number.isSafeInteger },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolutionKind: { type: String, enum: ['AUTO', 'ADMIN'], default: null },
}, { timestamps: true });

AdminAlertSchema.index(
    { dedupeKey: 1 },
    { unique: true, partialFilterExpression: { active: true } }
);
AdminAlertSchema.index({ active: 1, lastSeenAt: -1 });
AdminAlertSchema.index({ targetType: 1, targetId: 1, lastSeenAt: -1 });

module.exports = mongoose.model('AdminAlert', AdminAlertSchema);
