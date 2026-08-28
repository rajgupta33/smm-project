const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const mongoose = require('mongoose');

const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');
const {
    adminAdjustWallet,
    debitWallet,
    legacyMajorToMinor,
} = require('../services/walletService');

const userId = '507f1f77bcf86cd799439011';
const fakeSession = {};

let balanceMinor;
let legacyMoney;
let ledgers;
let originals;

function ledgerInput(overrides = {}) {
    return {
        userId,
        amountMinor: 70000,
        type: 'ORDER',
        sourceType: 'ORDER',
        sourceId: 'order:test-1',
        idempotencyKey: 'order:test-1',
        actorType: 'USER',
        actorId: userId,
        description: 'Test order',
        session: fakeSession,
        ...overrides,
    };
}

beforeEach(() => {
    balanceMinor = 100000;
    legacyMoney = 1000;
    ledgers = new Map();
    originals = {
        findById: User.findById,
        findOneAndUpdate: User.findOneAndUpdate,
        updateOne: User.updateOne,
        ledgerCreate: WalletLedger.create,
        ledgerFindOne: WalletLedger.findOne,
        startSession: mongoose.startSession,
    };

    User.findById = async () => ({
        _id: userId,
        money: legacyMoney,
        walletBalanceMinor: balanceMinor,
    });
    User.updateOne = async () => ({ modifiedCount: 0 });
    User.findOneAndUpdate = async (filter, update) => {
        const requiredBalance = filter.walletBalanceMinor?.$gte ?? 0;
        if (balanceMinor < requiredBalance) {
            return null;
        }

        const before = {
            _id: userId,
            money: legacyMoney,
            walletBalanceMinor: balanceMinor,
        };
        balanceMinor += update.$inc.walletBalanceMinor;
        legacyMoney += update.$inc.money;
        return before;
    };
    WalletLedger.findOne = async ({ idempotencyKey }) => ledgers.get(idempotencyKey) || null;
    WalletLedger.create = async ([entry]) => {
        if (ledgers.has(entry.idempotencyKey)) {
            const duplicateError = new Error('duplicate key');
            duplicateError.code = 11000;
            throw duplicateError;
        }
        const ledger = { _id: `ledger-${ledgers.size + 1}`, ...entry };
        ledgers.set(entry.idempotencyKey, ledger);
        return [ledger];
    };
});

afterEach(() => {
    User.findById = originals.findById;
    User.findOneAndUpdate = originals.findOneAndUpdate;
    User.updateOne = originals.updateOne;
    WalletLedger.create = originals.ledgerCreate;
    WalletLedger.findOne = originals.ledgerFindOne;
    mongoose.startSession = originals.startSession;
});

test('concurrent debits cannot overdraw the cached balance', async () => {
    const results = await Promise.allSettled([
        debitWallet(ledgerInput()),
        debitWallet(ledgerInput({
            sourceId: 'order:test-2',
            idempotencyKey: 'order:test-2',
        })),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(balanceMinor, 30000);
    assert.equal(legacyMoney, 300);
    assert.equal(ledgers.size, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'INSUFFICIENT_FUNDS');
});

test('replaying an idempotency key returns the original ledger without a second debit', async () => {
    const first = await debitWallet(ledgerInput());
    const second = await debitWallet(ledgerInput());

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(String(second.ledger._id), String(first.ledger._id));
    assert.equal(balanceMinor, 30000);
    assert.equal(ledgers.size, 1);
});

test('reusing an idempotency key for a different amount is rejected', async () => {
    await debitWallet(ledgerInput());

    await assert.rejects(
        debitWallet(ledgerInput({ amountMinor: 100 })),
        (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.statusCode === 409
    );
    assert.equal(balanceMinor, 30000);
    assert.equal(ledgers.size, 1);
});

test('admin credit records before and after balances in integer paise', async () => {
    const result = await adminAdjustWallet(ledgerInput({
        direction: 'CREDIT',
        amountMinor: 2505,
        sourceType: 'ADMIN_ADJUSTMENT',
        sourceId: 'adjustment:test-1',
        idempotencyKey: 'adjustment:test-1',
        actorType: 'ADMIN',
        type: undefined,
        description: 'Correction approved by finance',
    }));

    assert.equal(result.ledger.type, 'ADMIN_ADJUSTMENT');
    assert.equal(result.ledger.balanceBeforeMinor, 100000);
    assert.equal(result.ledger.balanceAfterMinor, 102505);
    assert.equal(balanceMinor, 102505);
    assert.equal(legacyMoney, 1025.05);
});

test('wallet service owns a MongoDB transaction when no session is supplied', async () => {
    let transactionCount = 0;
    let ended = false;
    mongoose.startSession = async () => ({
        async withTransaction(operation) {
            transactionCount += 1;
            await operation();
        },
        async endSession() {
            ended = true;
        },
    });

    const input = ledgerInput({
        session: undefined,
        direction: 'CREDIT',
        amountMinor: 100,
        sourceType: 'ADMIN_ADJUSTMENT',
        sourceId: 'adjustment:transaction-test',
        idempotencyKey: 'adjustment:transaction-test',
        actorType: 'ADMIN',
        description: 'Transaction wrapper test',
    });
    const result = await adminAdjustWallet(input);

    assert.equal(result.created, true);
    assert.equal(transactionCount, 1);
    assert.equal(ended, true);
});

test('an unmigrated legacy balance is initialized once before mutation', async () => {
    balanceMinor = undefined;
    let initializationCount = 0;
    User.updateOne = async (filter, update) => {
        if (filter.walletBalanceMinor?.$exists === false && balanceMinor === undefined) {
            balanceMinor = update.$set.walletBalanceMinor;
            initializationCount += 1;
            return { modifiedCount: 1 };
        }
        return { modifiedCount: 0 };
    };

    const result = await debitWallet(ledgerInput({ amountMinor: 2500 }));

    assert.equal(initializationCount, 1);
    assert.equal(result.ledger.balanceBeforeMinor, 100000);
    assert.equal(result.ledger.balanceAfterMinor, 97500);
    assert.equal(balanceMinor, 97500);
});

test('minor-unit inputs and legacy conversion reject invalid money', async () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assert.rejects(
            debitWallet(ledgerInput({ amountMinor: invalid })),
            (error) => error.code === 'INVALID_AMOUNT'
        );
    }

    assert.equal(legacyMajorToMinor(1.25), 125);
    assert.throws(() => legacyMajorToMinor(-1), /Legacy wallet balance is invalid/);
});

test('WalletLedger declares hard duplicate protection and immutable fields', () => {
    const indexes = WalletLedger.schema.indexes();
    const idempotencyIndex = indexes.find(([keys]) => keys.idempotencyKey === 1);
    assert.ok(idempotencyIndex);
    assert.equal(idempotencyIndex[1].unique, true);
    assert.equal(WalletLedger.schema.path('amountMinor').options.immutable, true);
    assert.equal(WalletLedger.schema.path('balanceAfterMinor').options.immutable, true);
});
