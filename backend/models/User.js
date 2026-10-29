const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
    userId: { type: String, unique: true, required: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    money: { type: Number, default: 0 },
    walletBalanceMinor: {
        type: Number,
        min: 0,
        validate: {
            validator: (value) => value === undefined || Number.isSafeInteger(value),
            message: 'walletBalanceMinor must be a safe integer number of paise',
        },
    },
    walletBalanceMigration: {
        source: { type: String },
        legacyMoney: { type: Number },
        migratedAt: { type: Date },
    },
    role: {
        type: String,
        required: true,
        enum: ['user', 'admin'],
    },
    services: [{
        type: String
    }],
    // Referral attribution. Set once at signup/creation and only an admin may
    // change it afterwards, with an audit entry, so commission cannot be moved
    // between resellers silently.
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ResellerProfile',
        default: null,
    },
    referredAt: { type: Date, default: null },
});

UserSchema.index({ referredBy: 1 });
module.exports = mongoose.model('User', UserSchema);
