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
    }]
});
module.exports = mongoose.model('User', UserSchema);
