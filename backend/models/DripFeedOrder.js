const mongoose = require('mongoose');

const positiveInteger = { type: Number, required: true, min: 1, validate: Number.isSafeInteger };
const nonNegativeInteger = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };

const DripFeedOrderSchema = new mongoose.Schema({
    workflowVersion: { type: Number, default: 2, enum: [2], required: true },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        unique: true,
        immutable: true,
    },
    totalQuantity: { ...positiveInteger, immutable: true },
    quantityPerRun: { ...positiveInteger, immutable: true },
    totalRuns: { ...positiveInteger, immutable: true },
    completedRuns: { ...nonNegativeInteger, default: 0 },
    intervalMinutes: { ...positiveInteger, immutable: true },
    nextRunAt: {
        type: Date,
        default: null
    },
    reservedAmountMinor: { ...positiveInteger, immutable: true },
    acceptedAmountMinor: { ...nonNegativeInteger, default: 0 },
    refundedAmountMinor: { ...nonNegativeInteger, default: 0 },
    status: {
        type: String,
        enum: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'RECONCILIATION_REQUIRED'],
        default: 'ACTIVE'
    }
}, { timestamps: true });

DripFeedOrderSchema.index({ status: 1, nextRunAt: 1 });

module.exports = mongoose.model('DripFeedOrder', DripFeedOrderSchema);

