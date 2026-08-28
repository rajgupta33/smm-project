const mongoose = require('mongoose');

const statuses = [
    'REQUESTED', 'VALIDATING', 'SENT_TO_PROVIDER', 'IN_PROGRESS',
    'COMPLETED', 'REJECTED', 'FAILED', 'EXPIRED', 'NEEDS_SUPPORT',
];

const RefillRequestSchema = new mongoose.Schema({
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, immutable: true },
    providerOrderId: { type: String, required: true, trim: true, immutable: true },
    status: { type: String, enum: statuses, default: 'REQUESTED', required: true },
    requestedAt: { type: Date, default: Date.now, required: true, immutable: true },
    eligibilitySnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    providerRefillId: { type: String, trim: true, default: undefined },
    cooldownUntil: { type: Date, required: true, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true },
    failureReason: { type: String, default: null },
    activeOrderKey: { type: String, default: undefined, trim: true },
    idempotencyKey: { type: String, required: true, trim: true, immutable: true },
    nextStatusCheckAt: { type: Date, default: null },
    lastStatusCheckAt: { type: Date, default: null },
    providerStatusSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
}, { timestamps: true });

RefillRequestSchema.index({ activeOrderKey: 1 }, { unique: true, sparse: true });
RefillRequestSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
RefillRequestSchema.index({ userId: 1, createdAt: -1 });
RefillRequestSchema.index({ status: 1, nextStatusCheckAt: 1 });
RefillRequestSchema.index({ providerRefillId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('RefillRequest', RefillRequestSchema);
module.exports.REFILL_STATUSES = statuses;
