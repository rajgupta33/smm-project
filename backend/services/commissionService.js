const CommissionLedger = require('../models/CommissionLedger');
const ResellerProfile = require('../models/ResellerProfile');
const Order = require('../models/Order');
const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');
const { creditWallet } = require('./walletService');

/**
 * Commission accrual and payout.
 *
 * Commission is a share of an order's PROFIT (`pricingSnapshot.grossSpreadMinor`),
 * never of the order total, so a commission can never exceed what the order
 * actually earned.
 *
 * Accrual is reconciled rather than hooked into the order hot path: every pass
 * re-derives what each order should owe from the orders themselves. The unique
 * (resellerProfileId, orderId) index makes that idempotent, so a replayed job,
 * a double status poll or a concurrent dashboard refresh cannot pay twice.
 */

const BASIS_POINT_SCALE = 10000;
const ACCRUING_LIFECYCLE = new Set([
    'INTENT_COMMITTED', 'SUBMITTING', 'SUBMITTED', 'MANUAL_PROCESSING', 'DRIP_FEED', 'COMPLETED',
]);

class CommissionError extends Error {
    constructor(message, code = 'COMMISSION_ERROR', statusCode = 400) {
        super(message);
        this.name = 'CommissionError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

/** Always rounds down, so the panel never pays out more than it earned. */
function commissionFor(profitMinor, commissionBps) {
    if (!Number.isSafeInteger(profitMinor) || profitMinor <= 0) return 0;
    if (!Number.isSafeInteger(commissionBps) || commissionBps <= 0) return 0;
    return Math.floor((profitMinor * commissionBps) / BASIS_POINT_SCALE);
}

function orderReferenceOf(order) {
    return order.localOrderId || order.orderId;
}

/**
 * Who earns on this order: the buyer themselves when they are a reseller,
 * otherwise the reseller who referred them. A reseller placing their own order
 * earns on it, which is exactly the "orders for their own customers" model.
 */
async function resolveAttribution(userId, profileCache = new Map()) {
    const key = String(userId);
    if (profileCache.has(key)) return profileCache.get(key);

    const user = await User.findById(userId).select('referredBy').lean();
    let result = null;
    if (user) {
        const own = await ResellerProfile.findOne({ userId }).select('commissionBps holdDays status').lean();
        if (own) {
            result = { profile: own, attribution: 'OWN_ORDER' };
        } else if (user.referredBy) {
            const referrer = await ResellerProfile.findById(user.referredBy)
                .select('commissionBps holdDays status').lean();
            if (referrer) result = { profile: referrer, attribution: 'REFERRAL' };
        }
    }
    // A paused or disabled reseller stops accruing new commission but keeps
    // whatever is already in the ledger.
    if (result && result.profile.status !== 'ACTIVE') result = null;
    profileCache.set(key, result);
    return result;
}

/** How much of this order has been refunded, summed from the wallet ledger. */
async function refundedMinorFor(order) {
    const reference = orderReferenceOf(order);
    const [row] = await WalletLedger.aggregate([
        { $match: { sourceType: 'ORDER', sourceId: reference, direction: 'CREDIT', type: 'REFUND' } },
        { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]);
    return row?.total || 0;
}

function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Brings one order's commission row in line with the order's current state.
 * Returns what changed, or null when the order earns nothing.
 */
async function reconcileOrder(order, { now = new Date(), profileCache } = {}) {
    const snapshot = order.pricingSnapshot;
    if (!snapshot || !Number.isSafeInteger(snapshot.grossSpreadMinor)) return null;
    if (!ACCRUING_LIFECYCLE.has(order.lifecycleStatus)) return null;

    const existing = await CommissionLedger.findOne({ orderId: order._id });
    const attribution = existing
        ? { profile: await ResellerProfile.findById(existing.resellerProfileId).lean(), attribution: existing.attribution }
        : await resolveAttribution(order.user, profileCache);
    if (!attribution || !attribution.profile) return null;

    const profile = attribution.profile;

    if (!existing) {
        const commissionMinor = commissionFor(snapshot.grossSpreadMinor, profile.commissionBps);
        if (commissionMinor <= 0) return null;
        const completed = order.lifecycleStatus === 'COMPLETED';
        const completedAt = completed ? (order.updatedAt || now) : null;
        try {
            const created = await CommissionLedger.create({
                resellerProfileId: profile._id,
                resellerUserId: profile.userId,
                orderId: order._id,
                orderReference: orderReferenceOf(order),
                attribution: attribution.attribution,
                customerUserId: order.user,
                status: completed ? 'HELD' : 'PENDING',
                commissionBps: profile.commissionBps,
                orderProfitMinor: snapshot.grossSpreadMinor,
                orderSellingTotalMinor: snapshot.sellingTotalMinor,
                commissionMinor,
                holdDays: profile.holdDays,
                completedAt,
                availableAt: completed ? addDays(completedAt, profile.holdDays) : null,
            });
            return { action: 'ACCRUED', entry: created };
        } catch (error) {
            // Another pass won the race; its row is equivalent.
            if (error.code === 11000) return null;
            throw error;
        }
    }

    if (existing.status === 'PAID' || existing.status === 'REVERSED') return null;

    // A refund claws the commission back before it is ever paid.
    if (order.fundingStatus !== 'DEBITED') {
        const refunded = await refundedMinorFor(order);
        if (refunded > 0 && existing.orderSellingTotalMinor > 0) {
            const reversedMinor = refunded >= existing.orderSellingTotalMinor
                ? existing.commissionMinor
                : Math.ceil((existing.commissionMinor * refunded) / existing.orderSellingTotalMinor);
            const remaining = Math.max(0, existing.commissionMinor - reversedMinor);
            const updated = await CommissionLedger.findOneAndUpdate(
                { _id: existing._id, status: { $in: ['PENDING', 'HELD', 'AVAILABLE'] } },
                {
                    $set: {
                        commissionMinor: remaining,
                        reversedMinor,
                        reversedAt: now,
                        reversalReason: `Order refunded ${refunded} paise of ${existing.orderSellingTotalMinor}`,
                        ...(remaining === 0 ? { status: 'REVERSED' } : {}),
                    },
                },
                { new: true }
            );
            if (updated) return { action: 'REVERSED', entry: updated };
        }
    }

    if (existing.status === 'PENDING' && order.lifecycleStatus === 'COMPLETED') {
        const completedAt = order.updatedAt || now;
        const updated = await CommissionLedger.findOneAndUpdate(
            { _id: existing._id, status: 'PENDING' },
            {
                $set: {
                    status: 'HELD',
                    completedAt,
                    availableAt: addDays(completedAt, existing.holdDays),
                },
            },
            { new: true }
        );
        if (updated) return { action: 'HELD', entry: updated };
    }

    return null;
}

/**
 * Credits one AVAILABLE (or matured HELD) commission to the reseller's wallet.
 * The wallet write is idempotent on its own key, and the ledger row is claimed
 * with a guarded update first, so a concurrent sweep cannot double-credit.
 */
async function payCommission(entryId, { now = new Date() } = {}) {
    const claimed = await CommissionLedger.findOneAndUpdate(
        { _id: entryId, status: { $in: ['HELD', 'AVAILABLE'] }, availableAt: { $ne: null, $lte: now } },
        { $set: { status: 'AVAILABLE' } },
        { new: true }
    );
    if (!claimed) return null;
    if (claimed.commissionMinor <= 0) {
        await CommissionLedger.updateOne(
            { _id: claimed._id, status: 'AVAILABLE' },
            { $set: { status: 'REVERSED', reversedAt: now, reversalReason: 'Commission fully reversed before payout' } }
        );
        return null;
    }

    const result = await creditWallet({
        userId: claimed.resellerUserId,
        amountMinor: claimed.commissionMinor,
        type: 'PROMOTIONAL',
        sourceType: 'COMMISSION',
        sourceId: String(claimed._id),
        idempotencyKey: `commission-payout:${claimed._id}`,
        actorType: 'SYSTEM',
        description: `Reseller commission for order ${claimed.orderReference}`,
    });

    const paid = await CommissionLedger.findOneAndUpdate(
        { _id: claimed._id, status: 'AVAILABLE' },
        { $set: { status: 'PAID', paidAt: now, walletLedgerId: result?.ledger?._id || null } },
        { new: true }
    );
    if (paid) {
        await ResellerProfile.updateOne(
            { _id: paid.resellerProfileId },
            { $inc: { 'totals.paidMinor': paid.commissionMinor } }
        );
    }
    return paid;
}

/**
 * Reconciles recent orders, then pays out everything whose hold has expired.
 * Safe to run on a schedule and from a dashboard load at the same time.
 */
async function scanCommissions({ now = new Date(), lookbackDays = 90, limit = 500 } = {}) {
    const counts = { reconciled: 0, accrued: 0, held: 0, reversed: 0, paid: 0, failed: 0 };
    const profileCache = new Map();

    const orders = await Order.find({
        createdAt: { $gte: addDays(now, -lookbackDays) },
        pricingSnapshot: { $ne: null },
        lifecycleStatus: { $in: [...ACCRUING_LIFECYCLE] },
    }).sort({ updatedAt: -1 }).limit(limit);

    for (const order of orders) {
        try {
            const result = await reconcileOrder(order, { now, profileCache });
            if (result) {
                counts.reconciled += 1;
                if (result.action === 'ACCRUED') counts.accrued += 1;
                if (result.action === 'HELD') counts.held += 1;
                if (result.action === 'REVERSED') counts.reversed += 1;
            }
        } catch (error) {
            counts.failed += 1;
            console.error(`Commission reconcile failed for order ${order._id}:`, error.message);
        }
    }

    const due = await CommissionLedger.find({
        status: { $in: ['HELD', 'AVAILABLE'] },
        availableAt: { $ne: null, $lte: now },
    }).select('_id').limit(limit).lean();

    for (const entry of due) {
        try {
            if (await payCommission(entry._id, { now })) counts.paid += 1;
        } catch (error) {
            counts.failed += 1;
            console.error(`Commission payout failed for entry ${entry._id}:`, error.message);
        }
    }

    await refreshTotals();
    return counts;
}

/** Reconciles just one reseller's recent orders, for an on-demand dashboard load. */
async function scanCommissionsForReseller(profileId, { now = new Date(), lookbackDays = 90 } = {}) {
    const profile = await ResellerProfile.findById(profileId).lean();
    if (!profile) throw new CommissionError('Reseller not found', 'RESELLER_NOT_FOUND', 404);

    const referredIds = await User.find({ referredBy: profile._id }).select('_id').lean();
    const customerIds = [profile.userId, ...referredIds.map((row) => row._id)];

    const orders = await Order.find({
        user: { $in: customerIds },
        createdAt: { $gte: addDays(now, -lookbackDays) },
        pricingSnapshot: { $ne: null },
        lifecycleStatus: { $in: [...ACCRUING_LIFECYCLE] },
    }).sort({ updatedAt: -1 }).limit(300);

    const profileCache = new Map();
    for (const order of orders) {
        try {
            await reconcileOrder(order, { now, profileCache });
        } catch (error) {
            console.error(`Commission reconcile failed for order ${order._id}:`, error.message);
        }
    }

    const due = await CommissionLedger.find({
        resellerProfileId: profile._id,
        status: { $in: ['HELD', 'AVAILABLE'] },
        availableAt: { $ne: null, $lte: now },
    }).select('_id').limit(200).lean();
    for (const entry of due) {
        await payCommission(entry._id, { now }).catch((error) => {
            console.error(`Commission payout failed for entry ${entry._id}:`, error.message);
        });
    }

    await refreshTotals(profile._id);
}

/** Recomputes the cached per-reseller totals from the ledger. */
async function refreshTotals(profileId = null) {
    const match = profileId ? { resellerProfileId: profileId } : {};
    const rows = await CommissionLedger.aggregate([
        { $match: match },
        {
            $group: {
                _id: { profile: '$resellerProfileId', status: '$status' },
                amount: { $sum: '$commissionMinor' },
                reversed: { $sum: '$reversedMinor' },
            },
        },
    ]);

    const byProfile = new Map();
    for (const row of rows) {
        const key = String(row._id.profile);
        const entry = byProfile.get(key) || {
            _id: row._id.profile,
            totals: {
                'totals.pendingMinor': 0,
                'totals.heldMinor': 0,
                'totals.availableMinor': 0,
                'totals.paidMinor': 0,
                'totals.reversedMinor': 0,
            },
        };
        if (row._id.status === 'PENDING') entry.totals['totals.pendingMinor'] = row.amount;
        if (row._id.status === 'HELD') entry.totals['totals.heldMinor'] = row.amount;
        if (row._id.status === 'AVAILABLE') entry.totals['totals.availableMinor'] = row.amount;
        if (row._id.status === 'PAID') entry.totals['totals.paidMinor'] = row.amount;
        entry.totals['totals.reversedMinor'] += row.reversed;
        byProfile.set(key, entry);
    }

    const operations = [...byProfile.values()].map((entry) => ({
        updateOne: { filter: { _id: entry._id }, update: { $set: entry.totals } },
    }));
    if (operations.length) await ResellerProfile.bulkWrite(operations, { ordered: false });

    // Referred-customer counts are cheap and drift if an admin reassigns.
    const countFilter = profileId ? { referredBy: profileId } : { referredBy: { $ne: null } };
    const counts = await User.aggregate([
        { $match: countFilter },
        { $group: { _id: '$referredBy', total: { $sum: 1 } } },
    ]);
    if (counts.length) {
        await ResellerProfile.bulkWrite(
            counts.map((row) => ({
                updateOne: { filter: { _id: row._id }, update: { $set: { 'totals.referredCustomers': row.total } } },
            })),
            { ordered: false }
        );
    }
}

/** Ledger rows for a reseller, newest first. */
async function listCommissions(profileId, { status, limit = 50, skip = 0 } = {}) {
    const filter = { resellerProfileId: profileId };
    if (status) filter.status = status;
    const [entries, total] = await Promise.all([
        CommissionLedger.find(filter)
            .sort({ createdAt: -1 })
            .skip(Math.max(0, Number(skip) || 0))
            .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
            .lean(),
        CommissionLedger.countDocuments(filter),
    ]);
    return { total, entries };
}

module.exports = {
    BASIS_POINT_SCALE,
    CommissionError,
    commissionFor,
    listCommissions,
    payCommission,
    reconcileOrder,
    refreshTotals,
    scanCommissions,
    scanCommissionsForReseller,
};
