const mongoose = require('mongoose');

const safeInteger = { validator: Number.isSafeInteger, message: '{PATH} must be a safe integer' };
const columnLetter = { uppercase: true, trim: true, match: /^[A-Z]{1,3}$/ };

const ColumnMapSchema = new mongoose.Schema({
    name: { type: String, default: 'A', ...columnLetter },
    number: { type: String, default: 'B', ...columnLetter },
    link: { type: String, default: 'C', ...columnLetter },
    status: { type: String, default: 'D', ...columnLetter },
}, { _id: false });

/**
 * A WhatsApp promotion campaign. The spreadsheet is assigned by an admin and is
 * never exposed to resellers: spreadsheetId and sheetUrl are select:false so an
 * accidental find() in a reseller-facing path cannot leak them.
 *
 * Leads are mirrored into PromoLead on sync, which is what makes a claim atomic
 * and lets a number be re-released after a cooldown. The sheet stays the system
 * of record for the content and receives the "sent" write-back.
 */
const PromoCampaignSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    spreadsheetId: { type: String, required: true, trim: true, select: false },
    sheetUrl: { type: String, trim: true, default: '', select: false },
    tab: { type: String, required: true, trim: true, maxlength: 200 },
    columns: { type: ColumnMapSchema, default: () => ({}) },
    startRow: { type: Number, default: 2, min: 1, validate: safeInteger },
    // null = read to the end of the sheet.
    endRow: {
        type: Number,
        default: null,
        min: 1,
        validate: { validator: (v) => v === null || Number.isSafeInteger(v) },
    },
    /**
     * Fallback message used when a row carries no ready-made wa.me link.
     * Supports {{name}} and {{number}} placeholders.
     */
    messageTemplate: { type: String, trim: true, maxlength: 2000, default: '' },
    // Prepended to bare local numbers in the sheet (91 = India).
    defaultCountryCode: { type: String, trim: true, default: '91', match: /^[0-9]{1,4}$/ },
    status: {
        type: String,
        enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'],
        default: 'DRAFT',
        required: true,
    },
    // assignToAllResellers = every active reseller draws from this campaign.
    assignToAllResellers: { type: Boolean, default: true },
    assignedResellerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile' }],
    // A claimed-but-unsent lead returns to the pool after this many minutes.
    claimExpiryMinutes: { type: Number, default: 30, min: 1, max: 1440, validate: safeInteger },
    // A contacted-but-unconverted number can be retried by a different reseller
    // after this many days. 0 disables re-release (each number used once).
    releaseAfterDays: { type: Number, default: 30, min: 0, max: 365, validate: safeInteger },
    // Guardrail against WhatsApp bans and DPDP complaints: the hard ceiling on
    // how many times one number may ever be contacted across release cycles.
    maxContactsPerNumber: { type: Number, default: 2, min: 1, max: 10, validate: safeInteger },
    dailyShareCapOverride: {
        type: Number,
        default: null,
        min: 0,
        validate: { validator: (v) => v === null || Number.isSafeInteger(v) },
    },
    lastSyncedAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    stats: {
        totalLeads: { type: Number, default: 0, min: 0, validate: safeInteger },
        availableLeads: { type: Number, default: 0, min: 0, validate: safeInteger },
        sentLeads: { type: Number, default: 0, min: 0, validate: safeInteger },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });

PromoCampaignSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('PromoCampaign', PromoCampaignSchema);
