const mongoose = require('mongoose');

const safeInteger = { validator: Number.isSafeInteger, message: '{PATH} must be a safe integer' };

/**
 * A reseller is a normal `user` account with this profile attached, so every
 * existing role check, wallet path and order route keeps working unchanged.
 * Admin creates the profile; there is no self-signup for resellers.
 */
const ResellerProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        immutable: true,
    },
    // Public referral code used in /r/<code>. Uppercase, unique, admin editable.
    referralCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        minlength: 4,
        maxlength: 24,
        match: /^[A-Z0-9][A-Z0-9-]*$/,
    },
    displayName: { type: String, trim: true, maxlength: 120, default: '' },
    contactPhone: { type: String, trim: true, maxlength: 20, default: '' },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 160, default: '' },
    status: {
        type: String,
        enum: ['ACTIVE', 'PAUSED', 'DISABLED'],
        default: 'ACTIVE',
        required: true,
    },
    /**
     * Commission is a share of the order's PROFIT (grossSpreadMinor), never of
     * the order total, so a commission can never exceed what the order earned.
     * Stored per reseller in basis points: 2500 = 25%.
     */
    commissionBps: {
        type: Number,
        required: true,
        min: 0,
        max: 10000,
        default: 2500,
        validate: safeInteger,
    },
    // Days a completed order's commission stays HELD before it becomes AVAILABLE.
    holdDays: {
        type: Number,
        required: true,
        min: 0,
        max: 365,
        default: 7,
        validate: safeInteger,
    },
    // Marketing (WhatsApp) controls. Enabled for every reseller by default; the
    // campaign content itself is always assigned by an admin.
    marketingEnabled: { type: Boolean, default: true, required: true },
    dailyShareCap: {
        type: Number,
        required: true,
        min: 0,
        max: 5000,
        default: 100,
        validate: safeInteger,
    },
    // Running totals, maintained by commissionService. Reporting only; the
    // CommissionLedger remains the authoritative record.
    totals: {
        pendingMinor: { type: Number, default: 0, min: 0, validate: safeInteger },
        heldMinor: { type: Number, default: 0, min: 0, validate: safeInteger },
        availableMinor: { type: Number, default: 0, min: 0, validate: safeInteger },
        paidMinor: { type: Number, default: 0, min: 0, validate: safeInteger },
        reversedMinor: { type: Number, default: 0, min: 0, validate: safeInteger },
        referredCustomers: { type: Number, default: 0, min: 0, validate: safeInteger },
        leadsClaimed: { type: Number, default: 0, min: 0, validate: safeInteger },
        leadsSent: { type: Number, default: 0, min: 0, validate: safeInteger },
    },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });

ResellerProfileSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ResellerProfile', ResellerProfileSchema);
