const mongoose = require('mongoose');

const safeMoney = {
    validator: Number.isSafeInteger,
    message: '{PATH} must be an integer number of paise',
};

const PaymentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    merchantOrderId: { type: String, required: true, trim: true, immutable: true },
    gateway: { type: String, enum: ['CASHFREE'], default: 'CASHFREE', immutable: true },
    gatewayOrderId: { type: String, trim: true, default: null },
    gatewayPaymentId: { type: String, trim: true, default: undefined },
    paymentSessionId: { type: String, trim: true, default: null, select: false },
    amountMinor: { type: Number, required: true, min: 1, validate: safeMoney, immutable: true },
    currency: { type: String, enum: ['INR'], default: 'INR', immutable: true },
    status: {
        type: String,
        enum: ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED'],
        default: 'CREATED',
        required: true,
    },
    creditedAt: { type: Date, default: null },
    walletLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletLedger', default: null },
    idempotencyKey: { type: String, required: true, trim: true, immutable: true },
    gatewayIdempotencyKey: { type: String, required: true, trim: true, immutable: true, select: false },
    gatewayResponseSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    gatewayErrorCode: { type: String, default: null },
    lastReconciledAt: { type: Date, default: null },
    nextReconcileAt: { type: Date, default: null },
    reconciliationAttempts: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    completedAt: { type: Date, default: null },
}, { timestamps: true });

PaymentSchema.index({ merchantOrderId: 1 }, { unique: true });
PaymentSchema.index({ idempotencyKey: 1 }, { unique: true });
PaymentSchema.index({ gatewayPaymentId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ userId: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, nextReconcileAt: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);
