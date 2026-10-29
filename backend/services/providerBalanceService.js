const Order = require('../models/Order');
const Provider = require('../models/Provider');
const { getProviderAdapterForProvider } = require('../providers/providerRegistry');
const { raiseAlert, resolveAlert } = require('./adminAlertService');

const SPEND_WINDOW_DAYS = 7;
const WARNING_RUNWAY_HOURS = 72;
const CRITICAL_RUNWAY_HOURS = 24;
const FAILURES_BEFORE_ALERT = 3;
const INSUFFICIENT_FUNDS_PATTERN = /\b(not enough|insufficient|low)\s+(funds?|balance)\b|\bbalance\s+(is\s+)?(too\s+low|insufficient)\b/i;

const alertKeys = {
    lowBalance: (providerKey) => `provider-low-balance:${providerKey}`,
    insufficientFunds: (providerKey) => `provider-insufficient-funds:${providerKey}`,
    checkFailed: (providerKey) => `provider-balance-check:${providerKey}`,
};

function dependencies(overrides = {}) {
    return {
        Order,
        Provider,
        getProviderAdapterForProvider,
        raiseAlert,
        resolveAlert,
        ...overrides,
    };
}

function isInsufficientFundsMessage(message) {
    return typeof message === 'string' && INSUFFICIENT_FUNDS_PATTERN.test(message);
}

function rupees(minor) {
    return `₹${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Classifies a provider balance against the admin's fixed thresholds and the
 * time the balance would last at recent spend. Either signal can raise the level.
 */
function evaluateBalanceLevel({ balanceMinor, warningMinor, criticalMinor, avgDailySpendMinor }) {
    const runwayHours = avgDailySpendMinor > 0
        ? Math.max(0, Math.floor((balanceMinor * 24) / avgDailySpendMinor))
        : null;
    const reasons = [];
    if (Number.isSafeInteger(criticalMinor) && balanceMinor <= criticalMinor) reasons.push('BELOW_CRITICAL_AMOUNT');
    if (runwayHours !== null && runwayHours <= CRITICAL_RUNWAY_HOURS) reasons.push('RUNWAY_UNDER_CRITICAL_HOURS');
    if (reasons.length) return { level: 'CRITICAL', runwayHours, reasons };

    if (Number.isSafeInteger(warningMinor) && balanceMinor <= warningMinor) reasons.push('BELOW_WARNING_AMOUNT');
    if (runwayHours !== null && runwayHours <= WARNING_RUNWAY_HOURS) reasons.push('RUNWAY_UNDER_WARNING_HOURS');
    return { level: reasons.length ? 'WARNING' : 'OK', runwayHours, reasons };
}

function lowBalanceMessage(provider, balance, evaluation, avgDailySpendMinor) {
    const parts = [`Current balance is ${rupees(balance.balanceMinor)}${balance.currency ? ` ${balance.currency}` : ''}.`];
    const thresholds = [];
    if (Number.isSafeInteger(provider.lowBalanceWarningMinor)) thresholds.push(`warning at ${rupees(provider.lowBalanceWarningMinor)}`);
    if (Number.isSafeInteger(provider.lowBalanceCriticalMinor)) thresholds.push(`critical at ${rupees(provider.lowBalanceCriticalMinor)}`);
    if (thresholds.length) parts.push(`Limits: ${thresholds.join(', ')}.`);
    if (evaluation.runwayHours !== null) {
        parts.push(`At the last ${SPEND_WINDOW_DAYS} days' average spend of ${rupees(avgDailySpendMinor)}/day this lasts about ${evaluation.runwayHours} hours.`);
    }
    parts.push('Top up the provider account before orders start failing.');
    return parts.join(' ');
}

async function averageDailyProviderSpendMinor(providerId, now, OrderModel) {
    const since = new Date(now.getTime() - SPEND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [row] = await OrderModel.aggregate([
        {
            $match: {
                providerId,
                createdAt: { $gte: since },
                lifecycleStatus: { $nin: ['PROVIDER_REJECTED', 'CANCELLED'] },
            },
        },
        { $group: { _id: null, totalMinor: { $sum: '$pricingSnapshot.providerCostTotalMinor' } } },
    ]);
    return Math.ceil((row?.totalMinor || 0) / SPEND_WINDOW_DAYS);
}

async function recordBalanceFailure(provider, error, now, deps) {
    const providerKey = String(provider._id);
    const code = error?.code || 'PROVIDER_BALANCE_CHECK_FAILED';
    const updated = await deps.Provider.findOneAndUpdate(
        { _id: provider._id },
        {
            $inc: { balanceCheckFailures: 1 },
            $set: {
                balanceCheckError: {
                    code: String(code).slice(0, 100),
                    message: String(error?.message || 'Balance request failed').slice(0, 200),
                    at: now,
                },
            },
        },
        { new: true }
    );
    const failures = updated?.balanceCheckFailures || 1;
    if (failures >= FAILURES_BEFORE_ALERT) {
        await deps.raiseAlert({
            type: 'PROVIDER_BALANCE_CHECK_FAILED',
            severity: 'WARNING',
            dedupeKey: alertKeys.checkFailed(providerKey),
            title: `Cannot read ${provider.name} balance`,
            message: `The last ${failures} balance checks failed (${code}). Low-balance alerts for this provider are paused until a check succeeds.`,
            targetType: 'Provider',
            targetId: providerKey,
            metadata: { code, failures },
            now,
        });
    }
    return { providerId: providerKey, status: 'FAILED', code, failures };
}

async function checkProviderBalance(provider, options = {}) {
    const deps = dependencies(options.overrides);
    const now = options.now || new Date();
    const providerKey = String(provider._id);

    let balance;
    try {
        const adapter = deps.getProviderAdapterForProvider(provider);
        if (typeof adapter.getBalance !== 'function') {
            return { providerId: providerKey, status: 'UNSUPPORTED' };
        }
        balance = await adapter.getBalance();
    } catch (error) {
        return recordBalanceFailure(provider, error, now, deps);
    }

    const avgDailySpendMinor = await (options.averageDailySpend
        || ((id, at) => averageDailyProviderSpendMinor(id, at, deps.Order)))(provider._id, now);
    const evaluation = evaluateBalanceLevel({
        balanceMinor: balance.balanceMinor,
        warningMinor: provider.lowBalanceWarningMinor,
        criticalMinor: provider.lowBalanceCriticalMinor,
        avgDailySpendMinor,
    });

    await deps.Provider.updateOne({ _id: provider._id }, {
        $set: {
            balanceSnapshot: {
                balanceMinor: balance.balanceMinor,
                currency: balance.currency,
                checkedAt: now,
                avgDailySpendMinor,
                runwayHours: evaluation.runwayHours,
                level: evaluation.level,
            },
            balanceCheckFailures: 0,
            balanceCheckError: null,
        },
    });
    await deps.resolveAlert({ dedupeKey: alertKeys.checkFailed(providerKey), now });

    if (evaluation.level === 'OK') {
        await deps.resolveAlert({ dedupeKey: alertKeys.lowBalance(providerKey), now });
    } else {
        await deps.raiseAlert({
            type: 'PROVIDER_LOW_BALANCE',
            severity: evaluation.level,
            dedupeKey: alertKeys.lowBalance(providerKey),
            title: evaluation.level === 'CRITICAL'
                ? `${provider.name} balance is critically low`
                : `${provider.name} balance is running low`,
            message: lowBalanceMessage(provider, balance, evaluation, avgDailySpendMinor),
            targetType: 'Provider',
            targetId: providerKey,
            metadata: {
                balanceMinor: balance.balanceMinor,
                currency: balance.currency,
                avgDailySpendMinor,
                runwayHours: evaluation.runwayHours,
                reasons: evaluation.reasons,
            },
            now,
        });
    }
    // A provider that rejected orders for funds is presumed fixed once its balance is no longer critical.
    if (evaluation.level !== 'CRITICAL') {
        await deps.resolveAlert({ dedupeKey: alertKeys.insufficientFunds(providerKey), now });
    }
    return {
        providerId: providerKey,
        status: 'CHECKED',
        level: evaluation.level,
        balanceMinor: balance.balanceMinor,
    };
}

async function scanProviderBalances(options = {}) {
    const deps = dependencies(options.overrides);
    const now = options.now || new Date();
    let query = deps.Provider.find({ enabled: true, balanceMonitoringEnabled: { $ne: false } });
    if (typeof query?.select === 'function') query = query.select('+credentialReference');
    const providers = await query;

    const results = [];
    for (const provider of providers) {
        try {
            results.push(await checkProviderBalance(provider, { ...options, now }));
        } catch (error) {
            console.error(`Balance check failed for provider ${provider._id}:`, error.message);
            results.push({ providerId: String(provider._id), status: 'ERROR', code: error.code || 'BALANCE_SCAN_FAILED' });
        }
    }
    const counts = { scanned: providers.length, ok: 0, warning: 0, critical: 0, failed: 0 };
    for (const result of results) {
        if (result.status === 'CHECKED') counts[result.level.toLowerCase()] += 1;
        else if (result.status !== 'UNSUPPORTED') counts.failed += 1;
    }
    return { counts, results };
}

/** Raised from order submission when a provider rejects an order for lack of funds. */
async function reportInsufficientFunds({ providerId, orderReference, errorMessage, now = new Date() }, overrides = {}) {
    const deps = dependencies(overrides);
    const providerKey = providerId ? String(providerId) : 'legacy';
    return deps.raiseAlert({
        type: 'PROVIDER_INSUFFICIENT_FUNDS',
        severity: 'CRITICAL',
        dedupeKey: alertKeys.insufficientFunds(providerKey),
        title: 'Provider is rejecting orders for insufficient funds',
        message: `Order ${orderReference} was rejected and refunded because the provider replied "${String(errorMessage).slice(0, 200)}". Orders sent to this provider will keep failing until its balance is topped up.`,
        targetType: providerId ? 'Provider' : null,
        targetId: providerId ? providerKey : null,
        metadata: { lastOrderReference: orderReference },
        now,
    });
}

module.exports = {
    CRITICAL_RUNWAY_HOURS,
    FAILURES_BEFORE_ALERT,
    WARNING_RUNWAY_HOURS,
    alertKeys,
    checkProviderBalance,
    evaluateBalanceLevel,
    isInsufficientFundsMessage,
    reportInsufficientFunds,
    scanProviderBalances,
};
