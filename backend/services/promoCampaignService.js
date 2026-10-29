const PromoCampaign = require('../models/PromoCampaign');
const PromoLead = require('../models/PromoLead');
const ResellerProfile = require('../models/ResellerProfile');
const promoSheetClient = require('./promoSheetClient');

/**
 * Admin-side management of WhatsApp promo campaigns.
 *
 * Only an admin ever supplies the spreadsheet. Sync mirrors the sheet rows into
 * PromoLead so a reseller's click can claim a number atomically, and so the
 * same number is never handed to two people at once.
 */

class PromoCampaignError extends Error {
    constructor(message, code = 'PROMO_CAMPAIGN_ERROR', statusCode = 400) {
        super(message);
        this.name = 'PromoCampaignError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const COLUMN_PATTERN = /^[A-Za-z]{1,3}$/;

function assertColumns(input = {}) {
    const columns = {
        name: String(input.name || 'A').trim().toUpperCase(),
        number: String(input.number || 'B').trim().toUpperCase(),
        link: String(input.link || 'C').trim().toUpperCase(),
        status: String(input.status || 'D').trim().toUpperCase(),
    };
    for (const [field, value] of Object.entries(columns)) {
        if (!COLUMN_PATTERN.test(value)) {
            throw new PromoCampaignError(`columns.${field} must be a column letter such as A or AB`, 'INVALID_COLUMN');
        }
    }
    if (columns.number === columns.status) {
        throw new PromoCampaignError('The number and status columns must differ', 'INVALID_COLUMN');
    }
    return columns;
}

/**
 * Digits only, with a country code. A bare local number gets the campaign's
 * default country code so wa.me links resolve.
 */
function normalizePhone(raw, defaultCountryCode = '91') {
    const digits = String(raw || '').replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.length <= 10) return `${defaultCountryCode}${digits}`.slice(0, 15);
    return digits.slice(0, 15);
}

function assertBounded(value, field, min, max) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
        throw new PromoCampaignError(`${field} must be an integer between ${min} and ${max}`, 'INVALID_CAMPAIGN_FIELD');
    }
    return numeric;
}

function buildWritablePayload(input, { partial = false } = {}) {
    const payload = {};
    if (input.name !== undefined || !partial) {
        const name = String(input.name || '').trim();
        if (!name) throw new PromoCampaignError('name is required', 'INVALID_CAMPAIGN_FIELD');
        payload.name = name;
    }
    if (input.description !== undefined) payload.description = String(input.description || '').trim();
    if (input.tab !== undefined || !partial) {
        const tab = String(input.tab || '').trim();
        if (!tab) throw new PromoCampaignError('tab is required', 'INVALID_CAMPAIGN_FIELD');
        payload.tab = tab;
    }
    if (input.columns !== undefined || !partial) payload.columns = assertColumns(input.columns);
    if (input.startRow !== undefined || !partial) {
        payload.startRow = assertBounded(input.startRow ?? 2, 'startRow', 1, 1000000);
    }
    if (input.endRow !== undefined) {
        payload.endRow = input.endRow === null || input.endRow === ''
            ? null
            : assertBounded(input.endRow, 'endRow', 1, 1000000);
    }
    if (input.messageTemplate !== undefined) {
        payload.messageTemplate = String(input.messageTemplate || '').trim();
    }
    if (input.defaultCountryCode !== undefined) {
        const code = String(input.defaultCountryCode || '91').replace(/\D+/g, '');
        if (!code || code.length > 4) {
            throw new PromoCampaignError('defaultCountryCode must be 1-4 digits', 'INVALID_CAMPAIGN_FIELD');
        }
        payload.defaultCountryCode = code;
    }
    if (input.status !== undefined) {
        if (!['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'].includes(input.status)) {
            throw new PromoCampaignError('status must be DRAFT, ACTIVE, PAUSED or ARCHIVED', 'INVALID_CAMPAIGN_FIELD');
        }
        payload.status = input.status;
    }
    if (input.assignToAllResellers !== undefined) {
        payload.assignToAllResellers = Boolean(input.assignToAllResellers);
    }
    if (input.assignedResellerIds !== undefined) {
        payload.assignedResellerIds = Array.isArray(input.assignedResellerIds)
            ? input.assignedResellerIds.filter(Boolean)
            : [];
    }
    if (input.claimExpiryMinutes !== undefined) {
        payload.claimExpiryMinutes = assertBounded(input.claimExpiryMinutes, 'claimExpiryMinutes', 1, 1440);
    }
    if (input.releaseAfterDays !== undefined) {
        payload.releaseAfterDays = assertBounded(input.releaseAfterDays, 'releaseAfterDays', 0, 365);
    }
    if (input.maxContactsPerNumber !== undefined) {
        payload.maxContactsPerNumber = assertBounded(input.maxContactsPerNumber, 'maxContactsPerNumber', 1, 10);
    }
    if (input.dailyShareCapOverride !== undefined) {
        payload.dailyShareCapOverride = input.dailyShareCapOverride === null || input.dailyShareCapOverride === ''
            ? null
            : assertBounded(input.dailyShareCapOverride, 'dailyShareCapOverride', 0, 5000);
    }
    if (input.endRow !== undefined && payload.endRow !== null) {
        const startRow = payload.startRow ?? input.startRow;
        if (Number.isSafeInteger(Number(startRow)) && payload.endRow < Number(startRow)) {
            throw new PromoCampaignError('endRow must not be before startRow', 'INVALID_CAMPAIGN_FIELD');
        }
    }
    return payload;
}

async function createCampaign(input, actor) {
    const spreadsheetId = promoSheetClient.extractSpreadsheetId(input.sheetUrl || input.spreadsheetId);
    if (!spreadsheetId) {
        throw new PromoCampaignError('A valid Google Sheet link or ID is required', 'INVALID_SHEET');
    }
    const payload = buildWritablePayload(input, { partial: false });
    const campaign = await PromoCampaign.create({
        ...payload,
        spreadsheetId,
        sheetUrl: String(input.sheetUrl || '').trim(),
        createdBy: actor?._id || null,
        updatedBy: actor?._id || null,
    });
    return campaign;
}

async function updateCampaign(campaignId, input, actor) {
    const campaign = await PromoCampaign.findById(campaignId);
    if (!campaign) throw new PromoCampaignError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);

    const payload = buildWritablePayload(input, { partial: true });
    if (input.sheetUrl) {
        const spreadsheetId = promoSheetClient.extractSpreadsheetId(input.sheetUrl);
        if (!spreadsheetId) throw new PromoCampaignError('A valid Google Sheet link is required', 'INVALID_SHEET');
        payload.spreadsheetId = spreadsheetId;
        payload.sheetUrl = String(input.sheetUrl).trim();
    }
    payload.updatedBy = actor?._id || null;
    return PromoCampaign.findByIdAndUpdate(campaign._id, { $set: payload }, { new: true });
}

/**
 * Pulls the sheet and mirrors it into PromoLead.
 *
 * A row already worked by a reseller is never reset: only presentation fields
 * (name, link) are refreshed, so re-syncing after the admin edits a message
 * cannot resurrect numbers that have already been contacted. Rows that vanish
 * from the sheet are retired unless someone is mid-claim on them.
 */
async function syncCampaign(campaignId, { now = new Date() } = {}) {
    const campaign = await PromoCampaign.findById(campaignId).select('+spreadsheetId +sheetUrl');
    if (!campaign) throw new PromoCampaignError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);

    let rows;
    try {
        rows = await promoSheetClient.fetchRows({
            spreadsheetId: campaign.spreadsheetId,
            tab: campaign.tab,
            columns: campaign.columns,
        });
    } catch (error) {
        campaign.lastSyncError = error.message.slice(0, 500);
        await campaign.save();
        throw error;
    }

    const startRow = campaign.startRow || 2;
    const endRow = campaign.endRow || Number.MAX_SAFE_INTEGER;
    const seenRowNumbers = [];
    const seenPhones = new Set();
    const operations = [];
    let skippedDuplicates = 0;
    let skippedInvalid = 0;

    for (const row of rows) {
        if (row.rowNumber < startRow || row.rowNumber > endRow) continue;
        const normalizedPhone = normalizePhone(row.number, campaign.defaultCountryCode);
        if (!normalizedPhone || normalizedPhone.length < 8) {
            if (row.number) skippedInvalid += 1;
            continue;
        }
        // The same number twice in one sheet would let two resellers message it.
        if (seenPhones.has(normalizedPhone)) {
            skippedDuplicates += 1;
            continue;
        }
        seenPhones.add(normalizedPhone);
        seenRowNumbers.push(row.rowNumber);

        // A row the sheet already marks as sent starts out of the pool, which is
        // what makes an import of a previously-worked sheet safe.
        const preMarked = Boolean(row.status);
        operations.push({
            updateOne: {
                filter: { campaignId: campaign._id, rowNumber: row.rowNumber },
                update: {
                    $set: {
                        displayName: row.name,
                        normalizedPhone,
                        rawPhone: row.number,
                        messageLink: row.link,
                        sheetStatus: row.status,
                    },
                    $setOnInsert: {
                        campaignId: campaign._id,
                        rowNumber: row.rowNumber,
                        state: preMarked ? 'EXHAUSTED' : 'AVAILABLE',
                        contactCount: preMarked ? 1 : 0,
                    },
                },
                upsert: true,
            },
        });
    }

    if (operations.length) await PromoLead.bulkWrite(operations, { ordered: false });

    // Rows removed from the sheet leave the pool, but a lead someone is holding
    // or has already sent is left alone so history and write-back stay honest.
    await PromoLead.updateMany(
        {
            campaignId: campaign._id,
            rowNumber: { $nin: seenRowNumbers },
            state: 'AVAILABLE',
        },
        { $set: { state: 'EXHAUSTED' } }
    );

    const [totalLeads, availableLeads, sentLeads] = await Promise.all([
        PromoLead.countDocuments({ campaignId: campaign._id }),
        PromoLead.countDocuments({ campaignId: campaign._id, state: 'AVAILABLE' }),
        PromoLead.countDocuments({ campaignId: campaign._id, state: { $in: ['SENT', 'EXHAUSTED'] } }),
    ]);

    campaign.lastSyncedAt = now;
    campaign.lastSyncError = null;
    campaign.stats = { totalLeads, availableLeads, sentLeads };
    await campaign.save();

    return {
        campaignId: campaign._id,
        rowsRead: rows.length,
        imported: operations.length,
        skippedDuplicates,
        skippedInvalid,
        totalLeads,
        availableLeads,
        sentLeads,
    };
}

/** Syncs every active campaign. Used by the scheduled worker. */
async function syncActiveCampaigns({ now = new Date() } = {}) {
    if (!promoSheetClient.isConfigured()) return { skipped: true, reason: 'PROMO_SHEET_NOT_CONFIGURED' };
    const campaigns = await PromoCampaign.find({ status: 'ACTIVE' }).select('_id').lean();
    const counts = { campaigns: campaigns.length, synced: 0, failed: 0 };
    for (const campaign of campaigns) {
        try {
            await syncCampaign(campaign._id, { now });
            counts.synced += 1;
        } catch (error) {
            counts.failed += 1;
            console.error(`Promo campaign sync failed for ${campaign._id}:`, error.message);
        }
    }
    return counts;
}

/** Campaigns a given reseller may draw from. */
function campaignFilterForReseller(profileId) {
    return {
        status: 'ACTIVE',
        $or: [
            { assignToAllResellers: true },
            { assignedResellerIds: profileId },
        ],
    };
}

async function listCampaigns({ status, limit = 50, skip = 0 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    const [campaigns, total] = await Promise.all([
        PromoCampaign.find(filter)
            .sort({ updatedAt: -1 })
            .skip(Math.max(0, Number(skip) || 0))
            .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
            .populate('assignedResellerIds', 'referralCode displayName')
            .lean(),
        PromoCampaign.countDocuments(filter),
    ]);
    return { total, campaigns };
}

/** Per-reseller progress on one campaign, for the admin detail view. */
async function getCampaignBreakdown(campaignId) {
    const campaign = await PromoCampaign.findById(campaignId).select('_id').lean();
    if (!campaign) throw new PromoCampaignError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);
    const rows = await PromoLead.aggregate([
        { $match: { campaignId: campaign._id } },
        { $group: { _id: { profile: '$sentByProfileId', state: '$state' }, count: { $sum: 1 } } },
    ]);
    const profileIds = [...new Set(rows.map((row) => row._id.profile).filter(Boolean).map(String))];
    const profiles = await ResellerProfile.find({ _id: { $in: profileIds } })
        .select('referralCode displayName').lean();
    const nameById = new Map(profiles.map((profile) => [String(profile._id), profile]));

    const byState = {};
    const byReseller = new Map();
    for (const row of rows) {
        byState[row._id.state] = (byState[row._id.state] || 0) + row.count;
        if (!row._id.profile) continue;
        const key = String(row._id.profile);
        const entry = byReseller.get(key) || {
            resellerProfileId: key,
            referralCode: nameById.get(key)?.referralCode || null,
            displayName: nameById.get(key)?.displayName || null,
            sent: 0,
        };
        if (row._id.state === 'SENT' || row._id.state === 'EXHAUSTED') entry.sent += row.count;
        byReseller.set(key, entry);
    }
    return { byState, byReseller: [...byReseller.values()].sort((a, b) => b.sent - a.sent) };
}

module.exports = {
    PromoCampaignError,
    campaignFilterForReseller,
    createCampaign,
    getCampaignBreakdown,
    listCampaigns,
    normalizePhone,
    syncActiveCampaigns,
    syncCampaign,
    updateCampaign,
};
