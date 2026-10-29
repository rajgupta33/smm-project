const Order = require('../models/Order');
const ResellerProfile = require('../models/ResellerProfile');
const User = require('../models/User');
const commissionService = require('../services/commissionService');
const promoLeadService = require('../services/promoLeadService');

/**
 * Reseller-facing endpoints.
 *
 * Every handler scopes its queries to `req.resellerProfile`, which
 * requireReseller loaded from the database. Nothing here ever trusts a
 * profile id, referral code or campaign id supplied by the browser as
 * authorization, only as a filter inside the reseller's own scope.
 */

function sendError(res, error, fallbackMessage) {
    if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error(`${fallbackMessage}:`, error);
    return res.status(500).json({ error: fallbackMessage });
}

function publicProfile(profile) {
    return {
        resellerProfileId: String(profile._id),
        referralCode: profile.referralCode,
        displayName: profile.displayName,
        status: profile.status,
        commissionBps: profile.commissionBps,
        commissionPercent: profile.commissionBps / 100,
        holdDays: profile.holdDays,
        marketingEnabled: profile.marketingEnabled,
        dailyShareCap: profile.dailyShareCap,
        totals: profile.totals,
    };
}

class ResellerController {
    /**
     * Dashboard. Reconciles this reseller's commissions first so a just-completed
     * order shows up without waiting for the scheduled sweep.
     */
    async getDashboard(req, res) {
        try {
            const profile = req.resellerProfile;
            await commissionService.scanCommissionsForReseller(profile._id).catch((error) => {
                console.error('On-demand commission scan failed:', error.message);
            });

            const [refreshed, commissions, referredCount, recentOrders] = await Promise.all([
                ResellerProfile.findById(profile._id).lean(),
                commissionService.listCommissions(profile._id, { limit: 20 }),
                User.countDocuments({ referredBy: profile._id }),
                Order.find({ user: profile.userId })
                    .sort({ createdAt: -1 })
                    .limit(10)
                    .select('orderId localOrderId service quantity lastStatus lifecycleStatus createdAt pricingSnapshot.sellingTotalMinor')
                    .lean(),
            ]);

            return res.status(200).json({
                reseller: publicProfile(refreshed || profile),
                referredCustomers: referredCount,
                commissions: commissions.entries,
                commissionTotal: commissions.total,
                recentOrders,
            });
        } catch (error) {
            return sendError(res, error, 'Failed to load the reseller dashboard');
        }
    }

    async listCommissions(req, res) {
        try {
            const result = await commissionService.listCommissions(req.resellerProfile._id, {
                status: req.query.status,
                limit: req.query.limit,
                skip: req.query.skip,
            });
            return res.status(200).json(result);
        } catch (error) {
            return sendError(res, error, 'Failed to list commissions');
        }
    }

    /** Referred customers, without exposing anything but their login and spend. */
    async listCustomers(req, res) {
        try {
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
            const customers = await User.find({ referredBy: req.resellerProfile._id })
                .select('userId referredAt')
                .sort({ referredAt: -1 })
                .limit(limit)
                .lean();
            return res.status(200).json({ customers });
        } catch (error) {
            return sendError(res, error, 'Failed to list referred customers');
        }
    }

    // ---- WhatsApp marketing -------------------------------------------------

    async getMarketingStatus(req, res) {
        try {
            const status = await promoLeadService.getMarketingStatus(req.resellerProfile._id);
            return res.status(200).json(status);
        } catch (error) {
            return sendError(res, error, 'Failed to load marketing status');
        }
    }

    /** Hands out the next number. One click, one lead. */
    async claimLead(req, res) {
        try {
            const lead = await promoLeadService.claimNextLead(req.resellerProfile._id, {
                campaignId: req.body.campaignId || null,
            });
            return res.status(200).json(lead);
        } catch (error) {
            return sendError(res, error, 'Failed to get the next number');
        }
    }

    async markSent(req, res) {
        try {
            const result = await promoLeadService.markLeadSent(
                req.resellerProfile._id, req.params.leadId
            );
            return res.status(200).json(result);
        } catch (error) {
            return sendError(res, error, 'Failed to mark the message as sent');
        }
    }

    /** "Couldn't send" — puts the number straight back into the pool. */
    async releaseLead(req, res) {
        try {
            const result = await promoLeadService.releaseLead(
                req.resellerProfile._id, req.params.leadId, { reason: req.body.reason }
            );
            return res.status(200).json(result);
        } catch (error) {
            return sendError(res, error, 'Failed to release the lead');
        }
    }

    /** Records a "do not contact me again" reply. */
    async optOutLead(req, res) {
        try {
            const result = await promoLeadService.optOutLead(req.resellerProfile._id, req.params.leadId);
            return res.status(200).json(result);
        } catch (error) {
            return sendError(res, error, 'Failed to record the opt-out');
        }
    }
}

module.exports = new ResellerController();
