const mongoose = require('mongoose');
const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');

class WalletError extends Error {
    constructor(message, code, statusCode = 400) {
        super(message);
        this.name = 'WalletError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function assertAmountMinor(amountMinor) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new WalletError(
            'amountMinor must be a positive integer number of paise',
            'INVALID_AMOUNT'
        );
    }
}

function assertText(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new WalletError(`${fieldName} is required`, 'INVALID_WALLET_REQUEST');
    }
    return value.trim();
}

function legacyMajorToMinor(amount) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
        throw new WalletError('Legacy wallet balance is invalid', 'INVALID_LEGACY_BALANCE', 409);
    }

    const amountMinor = Math.round((numericAmount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(amountMinor)) {
        throw new WalletError('Legacy wallet balance is too large', 'INVALID_LEGACY_BALANCE', 409);
    }
    return amountMinor;
}

async function executeQuery(query, session) {
    if (session && query && typeof query.session === 'function') {
        return query.session(session);
    }
    return query;
}

async function ensureMinorBalance(userId, session) {
    let user = await executeQuery(User.findById(userId), session);
    if (!user) {
        throw new WalletError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (Number.isSafeInteger(user.walletBalanceMinor)) {
        return user;
    }

    const legacyBalanceMinor = legacyMajorToMinor(user.money);
    await User.updateOne(
        { _id: user._id, walletBalanceMinor: { $exists: false } },
        {
            $set: {
                walletBalanceMinor: legacyBalanceMinor,
                walletBalanceMigration: {
                    source: 'legacy_money_lazy',
                    legacyMoney: user.money,
                    migratedAt: new Date(),
                },
            },
        },
        { session }
    );

    user = await executeQuery(User.findById(userId), session);
    if (!user || !Number.isSafeInteger(user.walletBalanceMinor)) {
        throw new WalletError('Wallet balance initialization failed', 'WALLET_INITIALIZATION_FAILED', 409);
    }
    return user;
}

function assertMatchingLedger(existingLedger, requested) {
    if (
        String(existingLedger.userId) !== String(requested.userId) ||
        existingLedger.direction !== requested.direction ||
        existingLedger.type !== requested.type ||
        existingLedger.amountMinor !== requested.amountMinor ||
        existingLedger.sourceType !== requested.sourceType ||
        existingLedger.sourceId !== requested.sourceId
    ) {
        throw new WalletError(
            'Idempotency key is already used for a different wallet operation',
            'IDEMPOTENCY_CONFLICT',
            409
        );
    }
}

async function findExistingLedger(requested, session) {
    const existingLedger = await executeQuery(
        WalletLedger.findOne({ idempotencyKey: requested.idempotencyKey }),
        session
    );
    if (existingLedger) {
        assertMatchingLedger(existingLedger, requested);
    }
    return existingLedger;
}

async function mutateWallet(requested, session) {
    const existingLedger = await findExistingLedger(requested, session);
    if (existingLedger) {
        return { ledger: existingLedger, created: false };
    }

    await ensureMinorBalance(requested.userId, session);

    const deltaMinor = requested.direction === 'CREDIT'
        ? requested.amountMinor
        : -requested.amountMinor;
    const balanceFilter = {
        _id: requested.userId,
        walletBalanceMinor: requested.direction === 'DEBIT'
            ? { $gte: requested.amountMinor }
            : { $gte: 0 },
    };

    const balanceBefore = await User.findOneAndUpdate(
        balanceFilter,
        {
            $inc: {
                walletBalanceMinor: deltaMinor,
                // Compatibility mirror only. walletBalanceMinor is authoritative.
                money: deltaMinor / 100,
            },
        },
        { new: false, session }
    );

    if (!balanceBefore) {
        throw new WalletError('Insufficient wallet balance', 'INSUFFICIENT_FUNDS', 400);
    }

    const balanceBeforeMinor = balanceBefore.walletBalanceMinor;
    const balanceAfterMinor = balanceBeforeMinor + deltaMinor;
    const [ledger] = await WalletLedger.create([{
        userId: requested.userId,
        direction: requested.direction,
        type: requested.type,
        amountMinor: requested.amountMinor,
        currency: 'INR',
        balanceBeforeMinor,
        balanceAfterMinor,
        sourceType: requested.sourceType,
        sourceId: requested.sourceId,
        idempotencyKey: requested.idempotencyKey,
        actorType: requested.actorType,
        actorId: requested.actorId || null,
        description: requested.description,
    }], { session });

    return { ledger, created: true };
}

async function runWalletMutation(input) {
    assertAmountMinor(input.amountMinor);

    const requested = {
        ...input,
        sourceType: assertText(input.sourceType, 'sourceType'),
        sourceId: assertText(input.sourceId, 'sourceId'),
        idempotencyKey: assertText(input.idempotencyKey, 'idempotencyKey'),
        description: assertText(input.description, 'description'),
    };

    if (input.session) {
        return mutateWallet(requested, input.session);
    }

    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await mutateWallet(requested, session);
        });
        return result;
    } catch (error) {
        if (error && error.code === 11000) {
            const existingLedger = await findExistingLedger(requested);
            if (existingLedger) {
                return { ledger: existingLedger, created: false };
            }
        }
        throw error;
    } finally {
        await session.endSession();
    }
}

function creditWallet(input) {
    return runWalletMutation({ ...input, direction: 'CREDIT' });
}

function debitWallet(input) {
    return runWalletMutation({ ...input, direction: 'DEBIT' });
}

function refundWallet(input) {
    return creditWallet({ ...input, type: input.type || 'REFUND' });
}

function adminAdjustWallet(input) {
    if (!['CREDIT', 'DEBIT'].includes(input.direction)) {
        throw new WalletError('direction must be CREDIT or DEBIT', 'INVALID_DIRECTION');
    }
    return runWalletMutation({ ...input, type: 'ADMIN_ADJUSTMENT' });
}

async function getWalletStatement(userId, { page = 1, limit = 20 } = {}) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    return WalletLedger.find({ userId })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit);
}

module.exports = {
    WalletError,
    adminAdjustWallet,
    creditWallet,
    debitWallet,
    getWalletStatement,
    legacyMajorToMinor,
    refundWallet,
};
