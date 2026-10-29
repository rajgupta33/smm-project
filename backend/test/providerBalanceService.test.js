const assert = require('node:assert/strict');
const test = require('node:test');
const {
    alertKeys,
    checkProviderBalance,
    evaluateBalanceLevel,
    isInsufficientFundsMessage,
    reportInsufficientFunds,
    scanProviderBalances,
} = require('../services/providerBalanceService');

const NOW = new Date('2026-09-14T10:00:00Z');

function harness({ balance, balanceError, failures = 0, avgDailySpendMinor = 0 } = {}) {
    const raised = [];
    const resolved = [];
    const snapshots = [];
    let failureCount = failures;
    const provider = {
        _id: 'provider-1',
        name: 'Main panel',
        lowBalanceWarningMinor: 200000,
        lowBalanceCriticalMinor: 50000,
    };
    const overrides = {
        getProviderAdapterForProvider: () => ({
            async getBalance() {
                if (balanceError) throw balanceError;
                return balance;
            },
        }),
        raiseAlert: async (input) => { raised.push(input); },
        resolveAlert: async (input) => { resolved.push(input.dedupeKey); },
        Provider: {
            async updateOne(filter, update) { snapshots.push(update.$set); },
            async findOneAndUpdate(filter, update) {
                failureCount += update.$inc.balanceCheckFailures;
                return { balanceCheckFailures: failureCount };
            },
        },
    };
    return {
        provider,
        raised,
        resolved,
        snapshots,
        options: { overrides, now: NOW, averageDailySpend: async () => avgDailySpendMinor },
    };
}

test('balance level uses fixed limits and the hours left at recent spend', () => {
    const limits = { warningMinor: 200000, criticalMinor: 50000 };
    assert.equal(evaluateBalanceLevel({ ...limits, balanceMinor: 900000, avgDailySpendMinor: 0 }).level, 'OK');
    assert.deepEqual(evaluateBalanceLevel({ ...limits, balanceMinor: 150000, avgDailySpendMinor: 0 }), {
        level: 'WARNING', runwayHours: null, reasons: ['BELOW_WARNING_AMOUNT'],
    });
    assert.equal(evaluateBalanceLevel({ ...limits, balanceMinor: 40000, avgDailySpendMinor: 0 }).level, 'CRITICAL');

    // ₹10,000 left while spending ₹6,000 a day lasts 40 hours: above the fixed limits, but under three days.
    assert.deepEqual(evaluateBalanceLevel({ ...limits, balanceMinor: 1000000, avgDailySpendMinor: 600000 }), {
        level: 'WARNING', runwayHours: 40, reasons: ['RUNWAY_UNDER_WARNING_HOURS'],
    });
    assert.equal(evaluateBalanceLevel({ ...limits, balanceMinor: 1000000, avgDailySpendMinor: 1200000 }).level, 'CRITICAL');
    assert.equal(evaluateBalanceLevel({ warningMinor: null, criticalMinor: null, balanceMinor: 100, avgDailySpendMinor: 0 }).level, 'OK');
});

test('insufficient-funds detection matches common provider wording only', () => {
    for (const message of ['Not enough funds on balance', 'Insufficient balance', 'Your balance is too low', 'low funds']) {
        assert.equal(isInsufficientFundsMessage(message), true, message);
    }
    for (const message of ['Invalid link', 'Service disabled', 'Balance updated', undefined, null]) {
        assert.equal(isInsufficientFundsMessage(message), false, String(message));
    }
});

test('a critical balance stores a snapshot and raises one deduplicated alert', async () => {
    const context = harness({ balance: { balanceMinor: 30000, currency: 'INR' }, avgDailySpendMinor: 500000 });
    const result = await checkProviderBalance(context.provider, context.options);

    assert.deepEqual(result, { providerId: 'provider-1', status: 'CHECKED', level: 'CRITICAL', balanceMinor: 30000 });
    assert.deepEqual(context.snapshots[0], {
        balanceSnapshot: {
            balanceMinor: 30000, currency: 'INR', checkedAt: NOW,
            avgDailySpendMinor: 500000, runwayHours: 1, level: 'CRITICAL',
        },
        balanceCheckFailures: 0,
        balanceCheckError: null,
    });
    assert.equal(context.raised.length, 1);
    assert.equal(context.raised[0].dedupeKey, alertKeys.lowBalance('provider-1'));
    assert.equal(context.raised[0].severity, 'CRITICAL');
    assert.match(context.raised[0].message, /₹300\.00 INR/);
    assert.equal(context.resolved.includes(alertKeys.insufficientFunds('provider-1')), false);
});

test('a healthy balance resolves low-balance, failed-check, and insufficient-funds alerts', async () => {
    const context = harness({ balance: { balanceMinor: 5000000, currency: 'INR' } });
    const result = await checkProviderBalance(context.provider, context.options);
    assert.equal(result.level, 'OK');
    assert.equal(context.raised.length, 0);
    assert.deepEqual(context.resolved.sort(), [
        alertKeys.checkFailed('provider-1'),
        alertKeys.insufficientFunds('provider-1'),
        alertKeys.lowBalance('provider-1'),
    ].sort());
});

test('balance check failures alert only after repeated failures', async () => {
    const error = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
    const context = harness({ balanceError: error });

    assert.equal((await checkProviderBalance(context.provider, context.options)).failures, 1);
    assert.equal((await checkProviderBalance(context.provider, context.options)).failures, 2);
    assert.equal(context.raised.length, 0);

    const third = await checkProviderBalance(context.provider, context.options);
    assert.equal(third.status, 'FAILED');
    assert.equal(context.raised.length, 1);
    assert.equal(context.raised[0].type, 'PROVIDER_BALANCE_CHECK_FAILED');
    assert.equal(context.raised[0].dedupeKey, alertKeys.checkFailed('provider-1'));
    assert.equal(context.snapshots.length, 0);
});

test('provider scan checks enabled monitored providers and survives one provider failing', async () => {
    const context = harness({ balance: { balanceMinor: 100000, currency: 'INR' } });
    let query;
    const providers = [
        { ...context.provider, _id: 'provider-1' },
        { ...context.provider, _id: 'provider-2' },
    ];
    context.options.overrides.Provider.find = (filter) => {
        query = filter;
        return { async select() { return providers; } };
    };
    const updateOne = context.options.overrides.Provider.updateOne;
    context.options.overrides.Provider.updateOne = async (filter, update) => {
        if (filter._id === 'provider-2') throw new Error('database unavailable');
        return updateOne(filter, update);
    };

    const originalError = console.error;
    console.error = () => {};
    try {
        const result = await scanProviderBalances(context.options);
        assert.deepEqual(query, { enabled: true, balanceMonitoringEnabled: { $ne: false } });
        assert.deepEqual(result.counts, { scanned: 2, ok: 0, warning: 1, critical: 0, failed: 1 });
    } finally {
        console.error = originalError;
    }
});

test('insufficient-funds alerts are critical and keyed by provider', async () => {
    const raised = [];
    await reportInsufficientFunds({
        providerId: 'provider-9', orderReference: 'ord_1', errorMessage: 'Not enough funds on balance', now: NOW,
    }, { raiseAlert: async (input) => { raised.push(input); } });
    await reportInsufficientFunds({
        providerId: null, orderReference: 'ord_2', errorMessage: 'Insufficient balance', now: NOW,
    }, { raiseAlert: async (input) => { raised.push(input); } });

    assert.equal(raised[0].severity, 'CRITICAL');
    assert.equal(raised[0].dedupeKey, 'provider-insufficient-funds:provider-9');
    assert.match(raised[0].message, /ord_1/);
    assert.equal(raised[1].dedupeKey, 'provider-insufficient-funds:legacy');
    assert.equal(raised[1].targetType, null);
});
