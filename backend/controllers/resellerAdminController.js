const { randomUUID } = require('crypto');
const ResellerProfile = require('../models/ResellerProfile');
const PromoCampaign = require('../models/PromoCampaign');
const PromoLead = require('../models/PromoLead');
const User = require('../models/User');
const resellerService = require('../services/resellerService');
const commissionService = require('../services/commissionService');
const promoCampaignService = require('../services/promoCampaignService');
const promoSheetClient = require('../services/promoSheetClient');

/**
 * Admin control over resellers and their WhatsApp campaigns.
 *
 * Every route here is already behind authenticate + requireAdmin + CSRF in
 * index.js, so these handlers only validate input and shape the response.
 */

function actorFor(req) {
    return { _id: req.currentUser?._id, requestId: req.get('X-Request-Id')?.slice(0, 200) || randomUUID() };
}

function sendError(res, error, fallbackMessage) {
    if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error(`${fallbackMessage}:`, error);
    return res.status(500).json({ error: fallbackMessage });
}

class ResellerAdminController {
    async listResellers(req, res) {
        try {
            const result = await resellerService.listResellers({
                status: req.query.status,
                search: req.query.search,
                limit: req.query.limit,
                skip: req.query.skip,
            });
            return res.status(200).json(result);
        } catch (error) {
            return sendError(res, error, 'Failed to list resellers');
        }
    }

    async createReseller(req, res) {
        try {
            const { user, profile } = await resellerService.createReseller(req.body, actorFor(req));
            return res.status(201).json({
                userId: user.userId,
                resellerProfileId: profile._id,
                referralCode: profile.referralCode,
                commissionBps: profile.commissionBps,
                holdDays: profile.holdDays,
                dailyShareCap: profile.dailyShareCap,
            });
        } catch (error) {
            return sendError(res, error, 'Failed to create reseller');
        }
    }

    /** Turns an existing customer account into a reseller. */
    async convertUser(req, res) {
        try {
            const { user, profile } = await resellerService.convertUserToReseller(
                req.body.userId, req.body, actorFor(req)
            );
            return res.status(201).json({
                userId: user.userId,
                resellerProfileId: profile._id,
                referralCode: profile.referralCode,
            });
        } catch (error) {
            return sendError(res, error, 'Failed to convert user to reseller');
        }
    }

    async updateReseller(req, res) {
        try {
            const profile = await resellerService.updateReseller(
                req.params.profileId, req.body, actorFor(req)
            );
            return res.status(200).json({ reseller: profile });
        } catch (error) {
            return sendError(res, error, 'Failed to update reseller');
        }
    }

    /** Full detail for one reseller: profile, commissions, referred customers. */
    async getReseller(req, res) {
        try {
            const profile = await ResellerProfile.findById(req.params.profileId)
                .populate('userId', 'userId walletBalanceMinor money')
                .lean();
            if (!profile) return res.status(404).json({ error: 'Reseller not found' });

            const [commissions, customers, campaignCount] = await Promise.all([
                commissionService.listCommissions(profile._id, { limit: 50 }),
                User.find({ referredBy: profile._id })
                    .select('userId walletBalanceMinor referredAt')
                    .sort({ referredAt: -1 })
                    .limit(100)
                    .lean(),
                PromoCampaign.countDocuments({
                    $or: [{ assignToAllResellers: true }, { assignedResellerIds: profile._id }],
                    status: 'ACTIVE',
                }),
            ]);

            return res.status(200).json({
                reseller: {
                    ...profile,
                    login: profile.userId?.userId || null,
                    walletBalanceMinor: profile.userId?.walletBalanceMinor ?? 0,
                },
                commissions: commissions.entries,
                commissionTotal: commissions.total,
                referredCustomers: customers,
                activeCampaigns: campaignCount,
            });
        } catch (error) {
            return sendError(res, error, 'Failed to load reseller');
        }
    }

    /** Moves a customer to a different referring reseller. Always audited. */
    async reassignCustomer(req, res) {
        try {
            const customer = await resellerService.reassignCustomer(
                req.body.customerUserId, req.body.referralCode, actorFor(req)
            );
            return res.status(200).json({ userId: customer.userId, referredBy: customer.referredBy });
        } catch (error) {
            return sendError(res, error, 'Failed to reassign customer');
        }
    }

    /** Forces a commission reconcile + payout sweep across all resellers. */
    async runCommissionScan(req, res) {
        try {
            const counts = await commissionService.scanCommissions({});
            return res.status(200).json(counts);
        } catch (error) {
            return sendError(res, error, 'Commission scan failed');
        }
    }

    // ---- WhatsApp promo campaigns -------------------------------------------

    async listCampaigns(req, res) {
        try {
            const result = await promoCampaignService.listCampaigns({
                status: req.query.status,
                limit: req.query.limit,
                skip: req.query.skip,
            });
            return res.status(200).json({
                ...result,
                sheetConfigured: promoSheetClient.isConfigured(),
            });
        } catch (error) {
            return sendError(res, error, 'Failed to list campaigns');
        }
    }

    /** Lists a spreadsheet's tabs so the admin can pick one when assigning it. */
    async listSheetTabs(req, res) {
        try {
            const spreadsheetId = promoSheetClient.extractSpreadsheetId(req.query.sheetUrl);
            if (!spreadsheetId) {
                return res.status(400).json({ error: 'A valid Google Sheet link is required', code: 'INVALID_SHEET' });
            }
            const result = await promoSheetClient.listTabs(spreadsheetId);
            return res.status(200).json({ spreadsheetId, ...result });
        } catch (error) {
            return sendError(res, error, 'Failed to read the Google Sheet');
        }
    }

    async createCampaign(req, res) {
        try {
            const campaign = await promoCampaignService.createCampaign(req.body, actorFor(req));
            return res.status(201).json({ campaignId: campaign._id, campaign });
        } catch (error) {
            return sendError(res, error, 'Failed to create campaign');
        }
    }

    async updateCampaign(req, res) {
        try {
            const campaign = await promoCampaignService.updateCampaign(
                req.params.campaignId, req.body, actorFor(req)
            );
            return res.status(200).json({ campaign });
        } catch (error) {
            return sendError(res, error, 'Failed to update campaign');
        }
    }

    /** Pulls the sheet into the lead pool. Safe to run repeatedly. */
    async syncCampaign(req, res) {
        try {
            const result = await promoCampaignService.syncCampaign(req.params.campaignId, {});
            return res.status(200).json(result);
        } catch (error) {
            return sendError(res, error, 'Campaign sync failed');
        }
    }

    async getCampaign(req, res) {
        try {
            const campaign = await PromoCampaign.findById(req.params.campaignId)
                .populate('assignedResellerIds', 'referralCode displayName')
                .lean();
            if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
            const breakdown = await promoCampaignService.getCampaignBreakdown(campaign._id);
            return res.status(200).json({ campaign, ...breakdown });
        } catch (error) {
            return sendError(res, error, 'Failed to load campaign');
        }
    }

    /** Lead-level view for troubleshooting a campaign. */
    async listCampaignLeads(req, res) {
        try {
            const filter = { campaignId: req.params.campaignId };
            if (req.query.state) filter.state = req.query.state;
            const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
            const [leads, total] = await Promise.all([
                PromoLead.find(filter)
                    .sort({ rowNumber: 1 })
                    .skip(Math.max(0, Number(req.query.skip) || 0))
                    .limit(limit)
                    .populate('sentByProfileId', 'referralCode displayName')
                    .lean(),
                PromoLead.countDocuments(filter),
            ]);
            return res.status(200).json({ total, leads });
        } catch (error) {
            return sendError(res, error, 'Failed to list campaign leads');
        }
    }
}

module.exports = new ResellerAdminController();
