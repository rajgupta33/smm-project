const mongoose = require('mongoose');

const integerMinorUnit = {
    validator: Number.isSafeInteger,
    message: '{PATH} must be a safe integer number of paise',
};

/**
 * One immutable entry per commissionable order. The unique index on
 * (resellerProfileId, orderId) is what makes accrual idempotent: a repeated
 * status poll or a replayed job can never create a second commission for the
 * same order.
 *
 * State machine:
 *   PENDING   order placed, not yet completed
 *   HELD      order completed, inside the hold window
 *   AVAILABLE hold expired, ready to credit
 *   PAID      credited to the reseller wallet through walletService
 *   REVERSED  order refunded before payout (proportional on partial refunds)
 */
const CommissionLedgerSchema = new mongoose.Schema({
    resellerProfileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ResellerProfile',
        required: true,
        immutable: true,
    },
    resellerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        immutable: true,
    },
    orderReference: { type: String, required: true, trim: true, immutable: true },
    // Whose order earned this: the reseller's own order, or a referred customer's.
    attribution: {
        type: String,
        enum: ['OWN_ORDER', 'REFERRAL'],
        required: true,
        immutable: true,
    },
    customerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
    },
    status: {
        type: String,
        enum: ['PENDING', 'HELD', 'AVAILABLE', 'PAID', 'REVERSED'],
        default: 'PENDING',
        required: true,
    },
    // Snapshot of the inputs, so a later rate change never rewrites history.
    commissionBps: { type: Number, required: true, min: 0, max: 10000, validate: integerMinorUnit, immutable: true },
    orderProfitMinor: { type: Number, required: true, min: 0, validate: integerMinorUnit, immutable: true },
    orderSellingTotalMinor: { type: Number, required: true, min: 0, validate: integerMinorUnit, immutable: true },
    commissionMinor: { type: Number, required: true, min: 0, validate: integerMinorUnit },
    reversedMinor: { type: Number, default: 0, min: 0, validate: integerMinorUnit },
    currency: { type: String, enum: ['INR'], default: 'INR', immutable: true },
    holdDays: { type: Number, required: true, min: 0, max: 365, validate: integerMinorUnit, immutable: true },
    completedAt: { type: Date, default: null },
    availableAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
    // Wallet ledger entry created when this commission was paid.
    walletLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletLedger', default: null },
    reversalReason: { type: String, trim: true, maxlength: 300, default: null },
}, { timestamps: true, versionKey: false });

// Idempotency guard: one commission row per reseller per order.
CommissionLedgerSchema.index({ resellerProfileId: 1, orderId: 1 }, { unique: true });
// Payout sweep: find everything whose hold has expired.
CommissionLedgerSchema.index({ status: 1, availableAt: 1 });
CommissionLedgerSchema.index({ resellerProfileId: 1, createdAt: -1 });
CommissionLedgerSchema.index({ orderId: 1 });

module.exports = mongoose.model('CommissionLedger', CommissionLedgerSchema);
