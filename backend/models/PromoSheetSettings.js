const mongoose = require('mongoose');

/**
 * Global Google Apps Script bridge settings for reseller WhatsApp campaigns.
 *
 * Stored as a single document (`key: 'global'`) so an admin can configure and
 * test the deployed `tools/promo-sheet/Code.gs` URL and secret key directly
 * from the panel UI. Environment variables (`PROMO_SHEET_SCRIPT_URL` and
 * `PROMO_SHEET_SECRET_KEY`) act as an automatic fallback when present.
 *
 * `secretKey` is `select: false` so ordinary reads never leak it.
 */
const PromoSheetSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'global',
        enum: ['global'],
        unique: true,
        immutable: true,
    },
    appsScriptUrl: {
        type: String,
        trim: true,
        default: '',
        maxlength: 1000,
    },
    secretKey: {
        type: String,
        trim: true,
        default: '',
        maxlength: 500,
        select: false,
    },
    timeoutMs: {
        type: Number,
        default: 20000,
        min: 1000,
        max: 120000,
        validate: Number.isSafeInteger,
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('PromoSheetSettings', PromoSheetSettingsSchema);
