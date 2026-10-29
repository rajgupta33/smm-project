const mongoose = require('mongoose');

const safeInteger = { validator: Number.isSafeInteger, message: '{PATH} must be a safe integer' };

/**
 * One row of a campaign's sheet, mirrored locally so a claim can be atomic.
 *
 * AVAILABLE -> CLAIMED (a reseller opened it) -> SENT (reseller confirmed, and
 * the sheet was stamped). A CLAIMED lead whose claimExpiresAt passes returns to
 * AVAILABLE; a SENT lead returns to AVAILABLE after the campaign cooldown,
 * unless contactCount has reached maxContactsPerNumber (EXHAUSTED) or the
 * number asked not to be contacted again (OPTED_OUT).
 */
const PromoLeadSchema = new mongoose.Schema({
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PromoCampaign',
        required: true,
        immutable: true,
    },
    rowNumber: { type: Number, required: true, min: 1, validate: safeInteger, immutable: true },
    displayName: { type: String, trim: true, maxlength: 200, default: '' },
    // Digits only, country code included, no plus sign.
    normalizedPhone: { type: String, required: true, trim: true, maxlength: 20 },
    rawPhone: { type: String, trim: true, maxlength: 40, default: '' },
    // The wa.me / api.whatsapp.com link taken from the sheet, when the row had one.
    messageLink: { type: String, trim: true, maxlength: 4000, default: '' },
    sheetStatus: { type: String, trim: true, maxlength: 200, default: '' },
    state: {
        type: String,
        enum: ['AVAILABLE', 'CLAIMED', 'SENT', 'EXHAUSTED', 'OPTED_OUT'],
        default: 'AVAILABLE',
        required: true,
    },
    claimedByProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile', default: null },
    claimedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    claimedAt: { type: Date, default: null },
    claimExpiresAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    sentByProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile', default: null },
    // When a SENT lead may return to the pool. null = never.
    releaseAt: { type: Date, default: null },
    contactCount: { type: Number, default: 0, min: 0, validate: safeInteger },
    lastContactedAt: { type: Date, default: null },
    // Resellers who already worked this number, so a re-released lead is never
    // handed back to the same person.
    contactedByProfileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile' }],
    sheetWriteBackAt: { type: Date, default: null },
    sheetWriteBackError: { type: String, default: null },
}, { timestamps: true, versionKey: false });

// The sheet row is the identity: a re-sync updates rather than duplicates.
PromoLeadSchema.index({ campaignId: 1, rowNumber: 1 }, { unique: true });
// Claim query: the next available lead in a campaign.
PromoLeadSchema.index({ campaignId: 1, state: 1, rowNumber: 1 });
// Sweeper: expired claims and cooldowns that have come due.
PromoLeadSchema.index({ state: 1, claimExpiresAt: 1 });
PromoLeadSchema.index({ state: 1, releaseAt: 1 });
// Duplicate-number detection inside one campaign.
PromoLeadSchema.index({ campaignId: 1, normalizedPhone: 1 });
PromoLeadSchema.index({ claimedByProfileId: 1, claimedAt: -1 });

module.exports = mongoose.model('PromoLead', PromoLeadSchema);
