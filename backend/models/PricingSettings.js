const mongoose = require('mongoose');

const PricingSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'global',
        enum: ['global'],
        unique: true,
        immutable: true,
    },
    globalMarkupBps: {
        type: Number,
        required: true,
        min: 0,
        validate: Number.isSafeInteger,
    },
    currency: {
        type: String,
        enum: ['INR'],
        default: 'INR',
        required: true,
    },
    pricingUnit: {
        type: Number,
        default: 1000,
        min: 1,
        validate: Number.isSafeInteger,
        required: true,
    },
    minimumMarginBps: {
        type: Number,
        default: 0,
        min: 0,
        validate: Number.isSafeInteger,
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    version: {
        type: Number,
        default: 1,
        min: 1,
        validate: Number.isSafeInteger,
        required: true,
    },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('PricingSettings', PricingSettingsSchema);
