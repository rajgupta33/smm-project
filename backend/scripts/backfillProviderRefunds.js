require('dotenv').config();
require('./migrationSafety');

const fs = require('fs');
const path = require('path');
const Order = require('../models/Order');
const User = require('../models/User');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');
const { refundWallet, WalletError } = require('../services/walletService');

// Input file: JSON array of { providerOrderId, refundedAmount, status }.
// refundedAmount is the customer-facing INR refund (rupees, not paise) that
// the provider's dashboard reported for a Partial/Canceled order.
function loadEntries(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) {
        throw new Error('Input file must contain a JSON array');
    }
    return entries;
}

function toAmountMinor(refundedAmount) {
    const amountMinor = Math.round(Number(refundedAmount) * 100);
    return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
}

function fundingStatusFor(order, amountMinor) {
    const sellingTotalMinor = order.pricingSnapshot?.sellingTotalMinor;
    if (Number.isSafeInteger(sellingTotalMinor) && amountMinor >= sellingTotalMinor) {
        return 'REFUNDED';
    }
    return 'PARTIALLY_REFUNDED';
}

async function run() {
    const applyChanges = process.argv.includes('--apply');
    const fileArg = process.argv.find((arg) => arg.endsWith('.json'));
    if (!fileArg) {
        throw new Error('Usage: node backfillProviderRefunds.js <entries.json> [--apply]');
    }
    const entries = loadEntries(path.resolve(fileArg));

    await connectToDatabase();

    const summary = {
        mode: applyChanges ? 'apply' : 'dry-run',
        scanned: entries.length,
        credited: 0,
        alreadyCredited: 0,
        skipped: 0,
        rows: [],
    };

    for (const entry of entries) {
        const providerOrderId = String(entry.providerOrderId || entry.orderId || '').trim();
        const amountMinor = toAmountMinor(entry.refundedAmount);
        const row = { providerOrderId, refundedAmount: entry.refundedAmount, status: entry.status };

        if (!providerOrderId || !amountMinor) {
            row.outcome = 'SKIPPED_INVALID_INPUT';
            summary.skipped += 1;
            summary.rows.push(row);
            continue;
        }

        const order = await Order.findOne({ providerOrderId });
        if (!order) {
            row.outcome = 'SKIPPED_ORDER_NOT_FOUND';
            summary.skipped += 1;
            summary.rows.push(row);
            continue;
        }

        const user = await User.findById(order.user).select('userId name email');
        row.orderReference = order.localOrderId || order.orderId;
        row.userId = user?.userId || user?.email || String(order.user);
        row.amountMinor = amountMinor;

        if (order.fundingStatus === 'REFUNDED') {
            row.outcome = 'SKIPPED_ALREADY_FULLY_REFUNDED';
            summary.alreadyCredited += 1;
            summary.rows.push(row);
            continue;
        }

        const orderReference = row.orderReference;
        if (!applyChanges) {
            row.outcome = 'WOULD_CREDIT';
            summary.credited += 1;
            summary.rows.push(row);
            continue;
        }

        try {
            const { created } = await refundWallet({
                userId: order.user,
                amountMinor,
                type: 'REFUND',
                sourceType: 'ORDER',
                sourceId: orderReference,
                idempotencyKey: `order-status-refund:${orderReference}`,
                actorType: 'ADMIN',
                description: `Refund for undelivered quantity on ${entry.status || 'provider-reported'} order ${orderReference}`,
            });

            await Order.updateOne(
                { _id: order._id },
                { $set: { fundingStatus: fundingStatusFor(order, amountMinor) } }
            );

            row.outcome = created ? 'CREDITED' : 'ALREADY_CREDITED_IDEMPOTENT';
            summary.credited += created ? 1 : 0;
            summary.alreadyCredited += created ? 0 : 1;
        } catch (error) {
            row.outcome = error instanceof WalletError ? `FAILED_${error.code}` : 'FAILED_UNEXPECTED';
            row.error = error.message;
            summary.skipped += 1;
        }
        summary.rows.push(row);
    }

    console.log(JSON.stringify(summary, null, 2));
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectFromDatabase();
    });
