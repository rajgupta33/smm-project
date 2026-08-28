const Order = require('../models/Order');
const User = require('../models/User');

const Provider = require('../models/Provider');
const Payment = require('../models/Payment');

class AnalyticsController {
    async getOverview(req, res) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const [
                totalCustomers,
                walletLiabilityDocs,
                todaysOrders,
                todaysRevenueDocs,
                pendingPayments,
                reconciliationRequired,
                providers
            ] = await Promise.all([
                User.countDocuments({ role: { $ne: 'admin' } }),
                
                User.aggregate([
                    { $match: { role: { $ne: 'admin' }, walletBalanceMinor: { $gt: 0 } } },
                    { $group: { _id: null, totalLiability: { $sum: '$walletBalanceMinor' } } }
                ]),
                
                Order.countDocuments({ createdAt: { $gte: today } }),
                
                // Today's revenue (sum of selling total for today's non-cancelled orders)
                Order.aggregate([
                    { $match: { createdAt: { $gte: today }, lifecycleStatus: { $ne: 'CANCELLED' } } },
                    { $group: { _id: null, totalRevenue: { $sum: '$pricingSnapshot.sellingTotalMinor' }, totalCost: { $sum: '$pricingSnapshot.providerCostTotalMinor' } } }
                ]),
                
                Payment.countDocuments({ status: 'PENDING' }),
                
                Order.countDocuments({ lifecycleStatus: 'RECONCILIATION_REQUIRED' }),
                
                Provider.find({}, 'name enabled healthStatus priority lastSuccessfulSyncAt createdAt updatedAt').lean()
            ]);

            const walletLiability = walletLiabilityDocs[0]?.totalLiability || 0;
            const todaysRevenue = todaysRevenueDocs[0]?.totalRevenue || 0;
            const todaysCost = todaysRevenueDocs[0]?.totalCost || 0;
            const todaysMargin = todaysRevenue - todaysCost;

            res.json({
                success: true,
                data: {
                    totalCustomers,
                    walletLiability,
                    todaysOrders,
                    todaysRevenue,
                    todaysMargin,
                    pendingPayments,
                    reconciliationRequired,
                    providers
                }
            });
        } catch (error) {
            console.error('Analytics Error:', error);
            res.status(500).json({ success: false, error: { message: 'Failed to load analytics' } });
        }
    }
}

module.exports = new AnalyticsController();

