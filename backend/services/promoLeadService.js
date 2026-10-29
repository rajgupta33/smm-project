const PromoCampaign = require('../models/PromoCampaign');
const PromoLead = require('../models/PromoLead');
const ResellerProfile = require('../models/ResellerProfile');
const promoSheetClient = require('./promoSheetClient');
const { campaignFilterForReseller } = require('./promoCampaignService');

/**
 * Lead allocation for reseller WhatsApp marketing.
 *
 * A reseller asks for "the next number"; this hands out exactly one and stamps
 * it with their id in the same atomic update, so two resellers clicking at the
 * same moment can never receive the same person. Marking a lead sent writes the
 * status back into the admin's Google Sheet, mirroring the WA Sender PWA.
 */

class PromoLeadError extends Error {
    constructor(message, code = 'PROMO_LEAD_ERROR', statusCode = 400) {
        super(message);
        this.name = 'PromoLeadError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const WA_LINK_PATTERN = /^(https?:\/\/(api\.whatsapp\.com|wa\.me|web\.whatsapp\.com)\/|whatsapp:)/i;

function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function renderTemplate(template, lead) {
    return String(template || '')
        .replace(/\{\{\s*name\s*\}\}/gi, lead.displayName || '')
        .replace(/\{\{\s*number\s*\}\}/gi, lead.normalizedPhone || '');
}

/**
 * The link the reseller's phone opens. A sheet link is used as-is when it is a
 * real WhatsApp URL; anything else falls back to the campaign template so a
 * malformed cell cannot redirect a reseller to an arbitrary site.
 */
function buildSendLink(lead, campaign) {
    if (lead.messageLink && WA_LINK_PATTERN.test(lead.messageLink)) return lead.messageLink;
    const text = renderTemplate(campaign.messageTemplate, lead);
    const query = text ? `?text=${encodeURIComponent(text)}` : '';
    return `https://wa.me/${lead.normalizedPhone}${query}`;
}

function publicLead(lead, campaign) {
    return {
        leadId: String(lead._id),
        campaignId: String(campaign._id),
        campaignName: campaign.name,
        displayName: lead.displayName || '',
        // Shown so the reseller can confirm who they are messaging.
        phone: lead.normalizedPhone,
        sendLink: buildSendLink(lead, campaign),
        claimExpiresAt: lead.claimExpiresAt,
        contactCount: lead.contactCount,
    };
}

async function requireActiveProfile(profileId) {
    const profile = await ResellerProfile.findById(profileId);
    if (!profile) throw new PromoLeadError('Reseller not found', 'RESELLER_NOT_FOUND', 404);
    if (profile.status !== 'ACTIVE') {
        throw new PromoLeadError('This reseller account is not active', 'RESELLER_INACTIVE', 403);
    }
    if (!profile.marketingEnabled) {
        throw new PromoLeadError('Marketing is turned off for this account', 'MARKETING_DISABLED', 403);
    }
    return profile;
}

/** How many leads this reseller has sent today, against their cap. */
async function getDailyUsage(profile, campaign = null, now = new Date()) {
    const since = startOfUtcDay(now);
    const filter = { sentByProfileId: profile._id, sentAt: { $gte: since } };
    if (campaign) filter.campaignId = campaign._id;
    const used = await PromoLead.countDocuments(filter);
    const cap = campaign && Number.isSafeInteger(campaign.dailyShareCapOverride)
        ? campaign.dailyShareCapOverride
        : profile.dailyShareCap;
    return { used, cap, remaining: Math.max(0, cap - used) };
}

/**
 * Returns the lead this reseller is already holding, if any, so a refresh or a
 * second device does not burn another number.
 */
async function getActiveClaim(profileId, { now = new Date() } = {}) {
    const lead = await PromoLead.findOne({
        claimedByProfileId: profileId,
        state: 'CLAIMED',
        claimExpiresAt: { $gt: now },
    }).sort({ claimedAt: -1 });
    if (!lead) return null;
    const campaign = await PromoCampaign.findById(lead.campaignId);
    if (!campaign) return null;
    return { lead, campaign };
}

/**
 * Atomically claims the next available lead.
 *
 * The guard on `state: 'AVAILABLE'` inside findOneAndUpdate is what serializes
 * concurrent clicks: the loser sees no document and simply tries the next row.
 * `contactedByProfileIds` keeps a re-released number away from the reseller who
 * already messaged it.
 */
async function claimNextLead(profileId, { campaignId = null, now = new Date() } = {}) {
    const profile = await requireActiveProfile(profileId);

    const existing = await getActiveClaim(profile._id, { now });
    if (existing) {
        return { ...publicLead(existing.lead, existing.campaign), resumed: true };
    }

    const campaignFilter = campaignFilterForReseller(profile._id);
    if (campaignId) campaignFilter._id = campaignId;
    const campaigns = await PromoCampaign.find(campaignFilter).sort({ updatedAt: -1 }).limit(20);
    if (!campaigns.length) {
        throw new PromoLeadError(
            'No campaign has been assigned to you yet. Ask the admin to assign one.',
            'NO_CAMPAIGN_ASSIGNED',
            404
        );
    }

    for (const campaign of campaigns) {
        const usage = await getDailyUsage(profile, campaign, now);
        if (usage.remaining <= 0) continue;

        const expiresAt = new Date(now.getTime() + campaign.claimExpiryMinutes * 60000);
        // A few attempts absorb losing a race to another reseller.
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const lead = await PromoLead.findOneAndUpdate(
                {
                    campaignId: campaign._id,
                    state: 'AVAILABLE',
                    contactedByProfileIds: { $ne: profile._id },
                },
                {
                    $set: {
                        state: 'CLAIMED',
                        claimedByProfileId: profile._id,
                        claimedByUserId: profile.userId,
                        claimedAt: now,
                        claimExpiresAt: expiresAt,
                    },
                },
                { new: true, sort: { rowNumber: 1 } }
            );
            if (lead) {
                await ResellerProfile.updateOne({ _id: profile._id }, { $inc: { 'totals.leadsClaimed': 1 } });
                return { ...publicLead(lead, campaign), resumed: false, dailyRemaining: usage.remaining - 1 };
            }
            // Nothing matched at all: this campaign is empty for this reseller.
            const anyLeft = await PromoLead.exists({
                campaignId: campaign._id,
                state: 'AVAILABLE',
                contactedByProfileIds: { $ne: profile._id },
            });
            if (!anyLeft) break;
        }
    }

    const capped = await Promise.all(
        campaigns.map((campaign) => getDailyUsage(profile, campaign, now))
    );
    if (capped.every((usage) => usage.remaining <= 0)) {
        throw new PromoLeadError(
            'You have reached today\'s sending limit. More numbers unlock tomorrow.',
            'DAILY_CAP_REACHED',
            429
        );
    }
    throw new PromoLeadError(
        'No numbers are left in your campaigns right now. Ask the admin to load more.',
        'NO_LEADS_AVAILABLE',
        404
    );
}

/**
 * Confirms a lead was messaged: stamps the sheet, then retires the number.
 *
 * The sheet write is best-effort. If Apps Script is unreachable the lead is
 * still marked sent locally (so the number is not handed to someone else) and
 * the failure is recorded for the sweeper to retry.
 */
async function markLeadSent(profileId, leadId, { now = new Date() } = {}) {
    const profile = await requireActiveProfile(profileId);
    const lead = await PromoLead.findOne({ _id: leadId, claimedByProfileId: profile._id, state: 'CLAIMED' });
    if (!lead) throw new PromoLeadError('That lead is no longer yours to send', 'LEAD_NOT_CLAIMED', 409);

    const campaign = await PromoCampaign.findById(lead.campaignId).select('+spreadsheetId');
    if (!campaign) throw new PromoLeadError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);

    const contactCount = lead.contactCount + 1;
    const exhausted = contactCount >= campaign.maxContactsPerNumber || campaign.releaseAfterDays === 0;
    const update = {
        state: exhausted ? 'EXHAUSTED' : 'SENT',
        sentAt: now,
        sentByProfileId: profile._id,
        contactCount,
        lastContactedAt: now,
        claimedByProfileId: null,
        claimedByUserId: null,
        claimExpiresAt: null,
        releaseAt: exhausted ? null : new Date(now.getTime() + campaign.releaseAfterDays * 86400000),
    };

    const label = profile.displayName || profile.referralCode;
    const stamp = `Sent ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${label}`;
    try {
        await promoSheetClient.markRow({
            spreadsheetId: campaign.spreadsheetId,
            tab: campaign.tab,
            statusColumn: campaign.columns.status,
            rowNumber: lead.rowNumber,
            value: stamp,
        });
        update.sheetStatus = stamp;
        update.sheetWriteBackAt = now;
        update.sheetWriteBackError = null;
    } catch (error) {
        update.sheetWriteBackError = error.message.slice(0, 500);
        console.error(`Promo sheet write-back failed for lead ${lead._id}:`, error.message);
    }

    const updated = await PromoLead.findOneAndUpdate(
        { _id: lead._id, state: 'CLAIMED' },
        { $set: update, $addToSet: { contactedByProfileIds: profile._id } },
        { new: true }
    );
    if (!updated) throw new PromoLeadError('That lead is no longer yours to send', 'LEAD_NOT_CLAIMED', 409);

    await ResellerProfile.updateOne({ _id: profile._id }, { $inc: { 'totals.leadsSent': 1 } });
    await PromoCampaign.updateOne(
        { _id: campaign._id },
        { $inc: { 'stats.sentLeads': 1, 'stats.availableLeads': -1 } }
    );

    return {
        leadId: String(updated._id),
        sheetUpdated: !updated.sheetWriteBackError,
        dailyUsage: await getDailyUsage(profile, campaign, now),
    };
}

/**
 * "I couldn't send this one." Returns the number to the pool immediately
 * without counting against the reseller's daily total.
 */
async function releaseLead(profileId, leadId, { reason = null } = {}) {
    const lead = await PromoLead.findOneAndUpdate(
        { _id: leadId, claimedByProfileId: profileId, state: 'CLAIMED' },
        {
            $set: {
                state: 'AVAILABLE',
                claimedByProfileId: null,
                claimedByUserId: null,
                claimedAt: null,
                claimExpiresAt: null,
            },
        },
        { new: true }
    );
    if (!lead) throw new PromoLeadError('That lead is no longer yours to release', 'LEAD_NOT_CLAIMED', 409);
    if (reason) console.info(`Promo lead ${lead._id} released: ${String(reason).slice(0, 120)}`);
    return { leadId: String(lead._id), state: lead.state };
}

/**
 * Permanently removes a number from every campaign. Used when someone replies
 * "stop" — honouring opt-outs is both a WhatsApp policy and a DPDP obligation.
 */
async function optOutLead(profileId, leadId) {
    const lead = await PromoLead.findById(leadId);
    if (!lead) throw new PromoLeadError('Lead not found', 'LEAD_NOT_FOUND', 404);
    if (lead.claimedByProfileId && String(lead.claimedByProfileId) !== String(profileId)
        && String(lead.sentByProfileId || '') !== String(profileId)) {
        throw new PromoLeadError('That lead is not yours', 'LEAD_NOT_CLAIMED', 403);
    }
    await PromoLead.updateMany(
        { normalizedPhone: lead.normalizedPhone },
        {
            $set: {
                state: 'OPTED_OUT',
                releaseAt: null,
                claimedByProfileId: null,
                claimedByUserId: null,
                claimExpiresAt: null,
            },
        }
    );
    return { leadId: String(lead._id), state: 'OPTED_OUT' };
}

/**
 * Returns expired claims and matured cooldowns to the pool, and retries sheet
 * write-backs that failed. Idempotent, so it can run on any interval.
 */
async function sweepLeads({ now = new Date() } = {}) {
    const counts = { expiredClaims: 0, released: 0, writeBacksRetried: 0, writeBacksFailed: 0 };

    const expired = await PromoLead.updateMany(
        { state: 'CLAIMED', claimExpiresAt: { $ne: null, $lte: now } },
        {
            $set: {
                state: 'AVAILABLE',
                claimedByProfileId: null,
                claimedByUserId: null,
                claimedAt: null,
                claimExpiresAt: null,
            },
        }
    );
    counts.expiredClaims = expired.modifiedCount || 0;

    const released = await PromoLead.updateMany(
        { state: 'SENT', releaseAt: { $ne: null, $lte: now } },
        { $set: { state: 'AVAILABLE', releaseAt: null } }
    );
    counts.released = released.modifiedCount || 0;

    if (promoSheetClient.isConfigured()) {
        const pending = await PromoLead.find({
            sheetWriteBackError: { $ne: null },
            state: { $in: ['SENT', 'EXHAUSTED'] },
        }).limit(50);
        for (const lead of pending) {
            try {
                const campaign = await PromoCampaign.findById(lead.campaignId).select('+spreadsheetId');
                if (!campaign) continue;
                await promoSheetClient.markRow({
                    spreadsheetId: campaign.spreadsheetId,
                    tab: campaign.tab,
                    statusColumn: campaign.columns.status,
                    rowNumber: lead.rowNumber,
                    value: lead.sheetStatus || `Sent ${lead.sentAt?.toISOString().slice(0, 10) || ''}`.trim(),
                });
                await PromoLead.updateOne(
                    { _id: lead._id },
                    { $set: { sheetWriteBackAt: now, sheetWriteBackError: null } }
                );
                counts.writeBacksRetried += 1;
            } catch (error) {
                counts.writeBacksFailed += 1;
                console.error(`Promo sheet write-back retry failed for ${lead._id}:`, error.message);
            }
        }
    }

    return counts;
}

/** What the reseller's marketing screen shows before they click anything. */
async function getMarketingStatus(profileId, { now = new Date() } = {}) {
    const profile = await ResellerProfile.findById(profileId);
    if (!profile) throw new PromoLeadError('Reseller not found', 'RESELLER_NOT_FOUND', 404);

    const campaigns = await PromoCampaign.find(campaignFilterForReseller(profile._id))
        .sort({ updatedAt: -1 })
        .limit(20);

    const summaries = [];
    for (const campaign of campaigns) {
        const [available, usage, sentByMe] = await Promise.all([
            PromoLead.countDocuments({
                campaignId: campaign._id,
                state: 'AVAILABLE',
                contactedByProfileIds: { $ne: profile._id },
            }),
            getDailyUsage(profile, campaign, now),
            PromoLead.countDocuments({ campaignId: campaign._id, sentByProfileId: profile._id }),
        ]);
        summaries.push({
            campaignId: String(campaign._id),
            name: campaign.name,
            description: campaign.description,
            availableLeads: available,
            sentByMe,
            dailyUsed: usage.used,
            dailyCap: usage.cap,
            dailyRemaining: usage.remaining,
        });
    }

    const active = await getActiveClaim(profile._id, { now });
    return {
        marketingEnabled: profile.marketingEnabled && profile.status === 'ACTIVE',
        configured: promoSheetClient.isConfigured(),
        dailyShareCap: profile.dailyShareCap,
        totals: {
            leadsClaimed: profile.totals?.leadsClaimed || 0,
            leadsSent: profile.totals?.leadsSent || 0,
        },
        campaigns: summaries,
        activeLead: active ? publicLead(active.lead, active.campaign) : null,
    };
}

module.exports = {
    PromoLeadError,
    buildSendLink,
    claimNextLead,
    getActiveClaim,
    getDailyUsage,
    getMarketingStatus,
    markLeadSent,
    optOutLead,
    releaseLead,
    sweepLeads,
};
