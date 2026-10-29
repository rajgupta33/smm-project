const bcrypt = require('bcrypt');
const { randomInt, randomUUID } = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const ResellerProfile = require('../models/ResellerProfile');
const CommissionLedger = require('../models/CommissionLedger');
const AuditLog = require('../models/AuditLog');
const { getRuntimeConfig } = require('../config/runtimeConfig');
const { normalizeUserId, buildUserIdQuery } = require('../utils/userId');

class ResellerError extends Error {
    constructor(message, code = 'RESELLER_ERROR', statusCode = 400) {
        super(message);
        this.name = 'ResellerError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

// No I/O/0/1 so a code read aloud over the phone cannot be mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomReferralCode(length = 7) {
    let code = '';
    for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return code;
}

function normalizeReferralCode(value) {
    return String(value || '').trim().toUpperCase();
}

function assertReferralCode(value) {
    const code = normalizeReferralCode(value);
    if (!/^[A-Z0-9][A-Z0-9-]{3,23}$/.test(code)) {
        throw new ResellerError(
            'Referral code must be 4-24 characters of letters, digits or hyphens',
            'INVALID_REFERRAL_CODE'
        );
    }
    return code;
}

async function generateUniqueReferralCode() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = randomReferralCode();
        const clash = await ResellerProfile.exists({ referralCode: code });
        if (!clash) return code;
    }
    throw new ResellerError('Could not allocate a referral code, please retry', 'REFERRAL_CODE_EXHAUSTED', 503);
}

function assertBoundedInteger(value, fieldName, min, max) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
        throw new ResellerError(`${fieldName} must be an integer between ${min} and ${max}`, 'INVALID_RESELLER_FIELD');
    }
    return numeric;
}

async function recordAudit(action, actor, targetId, { before = null, after = null, metadata = null } = {}) {
    try {
        await AuditLog.create({
            action,
            actorType: 'ADMIN',
            actorId: actor?._id || null,
            targetType: 'ResellerProfile',
            targetId: String(targetId),
            requestId: actor?.requestId || randomUUID(),
            before,
            after,
            metadata,
        });
    } catch (error) {
        // Auditing must never block the operation it describes.
        console.error(`Failed to write ${action} audit entry:`, error.message);
    }
}

/**
 * Creates a reseller: a normal `user` account plus its ResellerProfile.
 * Both writes share a transaction where the deployment supports one, so a
 * failure can never leave a login without its profile.
 */
async function createReseller(input, actor) {
    const config = getRuntimeConfig().reseller;
    const userId = normalizeUserId(input.userId);
    if (!userId) throw new ResellerError('userId is required', 'INVALID_RESELLER_FIELD');
    if (typeof input.password !== 'string' || input.password.length < 8) {
        throw new ResellerError('password must be at least 8 characters', 'INVALID_RESELLER_FIELD');
    }

    const commissionBps = assertBoundedInteger(
        input.commissionBps ?? config.defaultCommissionBps, 'commissionBps', 0, 10000
    );
    const holdDays = assertBoundedInteger(input.holdDays ?? config.defaultHoldDays, 'holdDays', 0, 365);
    const dailyShareCap = assertBoundedInteger(
        input.dailyShareCap ?? config.defaultDailyShareCap, 'dailyShareCap', 0, 5000
    );

    const existing = await User.findOne(buildUserIdQuery(userId));
    if (existing) throw new ResellerError('That user ID is already taken', 'USER_ID_TAKEN', 409);

    const referralCode = input.referralCode
        ? assertReferralCode(input.referralCode)
        : await generateUniqueReferralCode();
    if (await ResellerProfile.exists({ referralCode })) {
        throw new ResellerError('That referral code is already in use', 'REFERRAL_CODE_TAKEN', 409);
    }

    const hashedPassword = await bcrypt.hash(input.password, 10);
    let session = null;
    try {
        session = await mongoose.startSession();
        session.startTransaction();
    } catch {
        // Standalone MongoDB has no transactions; fall back to sequential writes
        // and clean up the user if the profile insert fails.
        session = null;
    }

    let user;
    let profile;
    try {
        const userDocs = await User.create([{
            userId,
            password: hashedPassword,
            role: 'user',
            services: Array.isArray(input.services) ? input.services : [],
            money: 0,
            walletBalanceMinor: 0,
        }], session ? { session } : {});
        user = userDocs[0];

        const profileDocs = await ResellerProfile.create([{
            userId: user._id,
            referralCode,
            displayName: String(input.displayName || '').trim(),
            contactPhone: String(input.contactPhone || '').trim(),
            contactEmail: String(input.contactEmail || '').trim(),
            status: 'ACTIVE',
            commissionBps,
            holdDays,
            marketingEnabled: input.marketingEnabled !== false,
            dailyShareCap,
            notes: String(input.notes || '').trim(),
            createdBy: actor?._id || null,
            updatedBy: actor?._id || null,
        }], session ? { session } : {});
        profile = profileDocs[0];

        if (session) await session.commitTransaction();
    } catch (error) {
        if (session) await session.abortTransaction().catch(() => {});
        else if (user?._id && !profile) await User.deleteOne({ _id: user._id }).catch(() => {});
        if (error.code === 11000) {
            throw new ResellerError('That user ID or referral code is already in use', 'RESELLER_DUPLICATE', 409);
        }
        throw error;
    } finally {
        if (session) session.endSession();
    }

    await recordAudit('RESELLER_CREATED', actor, profile._id, {
        after: { userId, referralCode, commissionBps, holdDays, dailyShareCap },
    });
    return { user, profile };
}

/** Promotes an existing customer account into a reseller. */
async function convertUserToReseller(userIdInput, input, actor) {
    const config = getRuntimeConfig().reseller;
    const query = buildUserIdQuery(userIdInput);
    if (!query) throw new ResellerError('userId is required', 'INVALID_RESELLER_FIELD');
    const user = await User.findOne(query);
    if (!user) throw new ResellerError('User not found', 'USER_NOT_FOUND', 404);
    if (user.role === 'admin') {
        throw new ResellerError('An admin account cannot also be a reseller', 'INVALID_RESELLER_TARGET', 409);
    }
    if (await ResellerProfile.exists({ userId: user._id })) {
        throw new ResellerError('That user is already a reseller', 'ALREADY_RESELLER', 409);
    }

    const referralCode = input.referralCode
        ? assertReferralCode(input.referralCode)
        : await generateUniqueReferralCode();

    const profile = await ResellerProfile.create({
        userId: user._id,
        referralCode,
        displayName: String(input.displayName || user.userId).trim(),
        contactPhone: String(input.contactPhone || '').trim(),
        contactEmail: String(input.contactEmail || '').trim(),
        commissionBps: assertBoundedInteger(
            input.commissionBps ?? config.defaultCommissionBps, 'commissionBps', 0, 10000
        ),
        holdDays: assertBoundedInteger(input.holdDays ?? config.defaultHoldDays, 'holdDays', 0, 365),
        marketingEnabled: input.marketingEnabled !== false,
        dailyShareCap: assertBoundedInteger(
            input.dailyShareCap ?? config.defaultDailyShareCap, 'dailyShareCap', 0, 5000
        ),
        createdBy: actor?._id || null,
        updatedBy: actor?._id || null,
    });

    await recordAudit('RESELLER_CREATED', actor, profile._id, {
        after: { userId: user.userId, referralCode, commissionBps: profile.commissionBps, holdDays: profile.holdDays },
        metadata: { converted: true },
    });
    return { user, profile };
}

const UPDATABLE_TEXT_FIELDS = ['displayName', 'contactPhone', 'contactEmail', 'notes'];

/**
 * Applies an admin edit. Commission and hold changes only affect commissions
 * accrued after the change: existing ledger rows snapshot their own rate.
 */
async function updateReseller(profileId, input, actor) {
    const profile = await ResellerProfile.findById(profileId);
    if (!profile) throw new ResellerError('Reseller not found', 'RESELLER_NOT_FOUND', 404);

    const changes = {};
    if (input.commissionBps !== undefined) {
        changes.commissionBps = assertBoundedInteger(input.commissionBps, 'commissionBps', 0, 10000);
    }
    if (input.holdDays !== undefined) {
        changes.holdDays = assertBoundedInteger(input.holdDays, 'holdDays', 0, 365);
    }
    if (input.dailyShareCap !== undefined) {
        changes.dailyShareCap = assertBoundedInteger(input.dailyShareCap, 'dailyShareCap', 0, 5000);
    }
    if (input.status !== undefined) {
        if (!['ACTIVE', 'PAUSED', 'DISABLED'].includes(input.status)) {
            throw new ResellerError('status must be ACTIVE, PAUSED or DISABLED', 'INVALID_RESELLER_FIELD');
        }
        changes.status = input.status;
    }
    if (input.marketingEnabled !== undefined) {
        changes.marketingEnabled = Boolean(input.marketingEnabled);
    }
    if (input.referralCode !== undefined) {
        const code = assertReferralCode(input.referralCode);
        if (code !== profile.referralCode) {
            const clash = await ResellerProfile.exists({ referralCode: code, _id: { $ne: profile._id } });
            if (clash) throw new ResellerError('That referral code is already in use', 'REFERRAL_CODE_TAKEN', 409);
            changes.referralCode = code;
        }
    }
    for (const field of UPDATABLE_TEXT_FIELDS) {
        if (input[field] !== undefined) changes[field] = String(input[field] || '').trim();
    }

    if (!Object.keys(changes).length) return profile;

    const before = UPDATABLE_TEXT_FIELDS
        .concat(['commissionBps', 'holdDays', 'dailyShareCap', 'status', 'marketingEnabled', 'referralCode'])
        .reduce((acc, key) => (key in changes ? { ...acc, [key]: profile[key] } : acc), {});

    changes.updatedBy = actor?._id || null;
    const updated = await ResellerProfile.findByIdAndUpdate(profile._id, { $set: changes }, { new: true });
    await recordAudit('RESELLER_UPDATED', actor, profile._id, { before, after: changes });
    return updated;
}

/** Reassigns a customer's referring reseller. Admin only, always audited. */
async function reassignCustomer(customerUserId, referralCode, actor) {
    const query = buildUserIdQuery(customerUserId);
    if (!query) throw new ResellerError('customerUserId is required', 'INVALID_RESELLER_FIELD');
    const customer = await User.findOne(query);
    if (!customer) throw new ResellerError('Customer not found', 'USER_NOT_FOUND', 404);

    let profile = null;
    if (referralCode) {
        profile = await ResellerProfile.findOne({ referralCode: normalizeReferralCode(referralCode) });
        if (!profile) throw new ResellerError('Referral code not found', 'REFERRAL_CODE_NOT_FOUND', 404);
        if (String(profile.userId) === String(customer._id)) {
            throw new ResellerError('A reseller cannot refer themselves', 'SELF_REFERRAL', 409);
        }
    }

    const previous = customer.referredBy;
    customer.referredBy = profile?._id || null;
    customer.referredAt = profile ? new Date() : null;
    await customer.save();

    if (previous && String(previous) !== String(profile?._id || '')) {
        await ResellerProfile.updateOne({ _id: previous }, { $inc: { 'totals.referredCustomers': -1 } });
    }
    if (profile && String(previous || '') !== String(profile._id)) {
        await ResellerProfile.updateOne({ _id: profile._id }, { $inc: { 'totals.referredCustomers': 1 } });
    }

    await recordAudit('RESELLER_ATTRIBUTION_CHANGED', actor, profile?._id || previous || customer._id, {
        before: { resellerProfileId: previous || null },
        after: { resellerProfileId: profile?._id || null },
        metadata: { customerUserId: customer.userId },
    });
    return customer;
}

/** Resolves the profile behind a logged-in request, or null for a plain customer. */
function getProfileForUser(userDatabaseId) {
    return ResellerProfile.findOne({ userId: userDatabaseId });
}

function findByReferralCode(code) {
    const normalized = normalizeReferralCode(code);
    if (!normalized) return Promise.resolve(null);
    return ResellerProfile.findOne({ referralCode: normalized, status: 'ACTIVE' });
}

/** Admin list view: profiles joined with their login and wallet balance. */
async function listResellers({ status, search, limit = 50, skip = 0 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (search) {
        const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { referralCode: { $regex: escaped, $options: 'i' } },
            { displayName: { $regex: escaped, $options: 'i' } },
            { contactEmail: { $regex: escaped, $options: 'i' } },
        ];
    }

    const [profiles, total] = await Promise.all([
        ResellerProfile.find(filter)
            .sort({ createdAt: -1 })
            .skip(Math.max(0, Number(skip) || 0))
            .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
            .populate('userId', 'userId role walletBalanceMinor money')
            .lean(),
        ResellerProfile.countDocuments(filter),
    ]);

    const profileIds = profiles.map((profile) => profile._id);
    const unpaid = await CommissionLedger.aggregate([
        { $match: { resellerProfileId: { $in: profileIds }, status: { $in: ['PENDING', 'HELD', 'AVAILABLE'] } } },
        { $group: { _id: { profile: '$resellerProfileId', status: '$status' }, amount: { $sum: '$commissionMinor' } } },
    ]);
    const unpaidByProfile = new Map();
    for (const row of unpaid) {
        const key = String(row._id.profile);
        const entry = unpaidByProfile.get(key) || { pendingMinor: 0, heldMinor: 0, availableMinor: 0 };
        if (row._id.status === 'PENDING') entry.pendingMinor = row.amount;
        if (row._id.status === 'HELD') entry.heldMinor = row.amount;
        if (row._id.status === 'AVAILABLE') entry.availableMinor = row.amount;
        unpaidByProfile.set(key, entry);
    }

    return {
        total,
        resellers: profiles.map((profile) => ({
            ...profile,
            login: profile.userId?.userId || null,
            walletBalanceMinor: Number.isSafeInteger(profile.userId?.walletBalanceMinor)
                ? profile.userId.walletBalanceMinor
                : Math.round((Number(profile.userId?.money || 0) + Number.EPSILON) * 100),
            userId: profile.userId?._id || profile.userId,
            outstanding: unpaidByProfile.get(String(profile._id))
                || { pendingMinor: 0, heldMinor: 0, availableMinor: 0 },
        })),
    };
}

module.exports = {
    ResellerError,
    assertReferralCode,
    convertUserToReseller,
    createReseller,
    findByReferralCode,
    generateUniqueReferralCode,
    getProfileForUser,
    listResellers,
    normalizeReferralCode,
    reassignCustomer,
    updateReseller,
};
