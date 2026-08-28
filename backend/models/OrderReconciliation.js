const mongoose = require('mongoose');

function httpsUrlOrNull(value) {
    if (value === null || value === undefined || value === '') return true;
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

const OrderReconciliationSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        unique: true,
        immutable: true,
    },
    workflowKind: {
        type: String,
        enum: ['STANDARD', 'DRIP_FEED'],
        required: true,
        immutable: true,
    },
    dripFeedRunId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DripFeedRun',
        default: null,
        immutable: true,
    },
    resolution: {
        type: String,
        enum: ['CONFIRMED_ACCEPTED', 'CONFIRMED_NOT_ACCEPTED'],
        required: true,
        immutable: true,
    },
    providerOrderId: {
        type: String,
        trim: true,
        maxlength: 200,
        default: null,
        immutable: true,
    },
    evidenceNote: {
        type: String,
        required: true,
        trim: true,
        minlength: 10,
        maxlength: 2000,
        immutable: true,
    },
    evidenceUrl: {
        type: String,
        trim: true,
        maxlength: 2048,
        default: null,
        validate: { validator: httpsUrlOrNull, message: 'evidenceUrl must be HTTPS' },
        immutable: true,
    },
    refundAmountMinor: {
        type: Number,
        min: 0,
        validate: Number.isSafeInteger,
        default: 0,
        immutable: true,
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
    },
    requestId: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
        immutable: true,
    },
    resolvedAt: { type: Date, required: true, default: Date.now, immutable: true },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
});

OrderReconciliationSchema.index({ resolvedBy: 1, requestId: 1 }, { unique: true });
OrderReconciliationSchema.index({ resolvedAt: -1 });

function rejectMutation() {
    throw new Error('OrderReconciliation records are immutable');
}

for (const operation of [
    'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace',
    'findOneAndUpdate', 'replaceOne', 'updateOne', 'updateMany',
]) {
    OrderReconciliationSchema.pre(operation, rejectMutation);
}

module.exports = mongoose.model('OrderReconciliation', OrderReconciliationSchema);
