require('dotenv').config();
require('./migrationSafety');

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');
const { models } = require('./ensureProductionIndexes');

const User = require('../models/User');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WalletLedger = require('../models/WalletLedger');
const Service = require('../models/Service');
const CatalogueService = require('../models/CatalogueService');
const Provider = require('../models/Provider');
const ProviderOffer = require('../models/ProviderOffer');

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

function indexSignature(keys) {
    return JSON.stringify(Object.entries(keys));
}

async function duplicateGroups(collection, keys, match = {}) {
    const id = Object.fromEntries(keys.map((key) => [key, `$${key}`]));
    // This is the native driver collection, whose aggregate() returns a cursor
    // rather than a promise for an array. It must be drained with toArray()
    // before destructuring.
    const [result] = await collection.aggregate([
        { $match: match },
        { $group: { _id: id, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: 'groups' },
    ]).toArray();
    return result?.groups || 0;
}

async function collectIds(Model) {
    const ids = [];
    for await (const document of Model.find({}).select('_id').lean().cursor()) {
        ids.push(String(document._id));
    }
    return ids;
}

async function missingBaselineIds(Model, ids) {
    let missing = 0;
    for (let offset = 0; offset < ids.length; offset += 1000) {
        const rawBatch = ids.slice(offset, offset + 1000);
        const batch = rawBatch.filter((value) => mongoose.isValidObjectId(value));
        const found = await Model.countDocuments({ _id: { $in: batch } });
        missing += (rawBatch.length - batch.length) + (batch.length - found);
    }
    return missing;
}

async function verifyIndexes(problems, report) {
    report.indexes = { modelsChecked: models.length, requiredUnique: 0, missingUnique: [] };
    const existingCollections = new Set(
        (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
            .map((item) => item.name)
    );
    for (const model of models) {
        const required = model.schema.indexes().filter(([, options]) => options.unique);
        report.indexes.requiredUnique += required.length;
        if (!required.length) continue;
        if (!existingCollections.has(model.collection.collectionName)) {
            for (const [keys] of required) report.indexes.missingUnique.push(`${model.modelName}:${indexSignature(keys)}`);
            continue;
        }
        const actual = await model.collection.indexes();
        for (const [keys] of required) {
            const signature = indexSignature(keys);
            if (!actual.some((index) => index.unique === true && indexSignature(index.key) === signature)) {
                report.indexes.missingUnique.push(`${model.modelName}:${signature}`);
            }
        }
    }
    if (report.indexes.missingUnique.length) problems.push('Required unique indexes are missing');
}

async function buildReport() {
    const problems = [];
    const report = { generatedAt: new Date().toISOString(), readOnly: true };
    report.counts = {
        users: await User.countDocuments({}),
        orders: await Order.countDocuments({}),
        transactions: await Transaction.countDocuments({}),
        walletLedger: await WalletLedger.countDocuments({}),
        catalogueServices: await CatalogueService.countDocuments({}),
        providers: await Provider.countDocuments({}),
        providerOffers: await ProviderOffer.countDocuments({}),
    };

    const [invalidWallets] = await User.aggregate([{
        $project: {
            walletBalanceMinor: 1,
            normalizedWallet: {
                $convert: { input: '$walletBalanceMinor', to: 'double', onError: null, onNull: null },
            },
            normalizedLegacyMinor: {
                $round: [{
                    $multiply: [{
                        $convert: { input: '$money', to: 'double', onError: null, onNull: null },
                    }, 100],
                }, 0],
            },
        },
    }, {
        $facet: {
            missingOrInvalid: [{
                $match: { $expr: { $or: [
                    { $eq: ['$normalizedWallet', null] },
                    { $lt: ['$normalizedWallet', 0] },
                    { $gt: ['$normalizedWallet', Number.MAX_SAFE_INTEGER] },
                    { $ne: ['$normalizedWallet', { $trunc: '$normalizedWallet' }] },
                ] } },
            }, { $count: 'count' }],
            compatibilityMismatch: [{
                $match: { $expr: { $ne: [
                    '$normalizedWallet',
                    '$normalizedLegacyMinor',
                ] } },
            }, { $count: 'count' }],
        },
    }]);
    report.walletBalances = {
        missingInvalidOrNegative: invalidWallets.missingOrInvalid[0]?.count || 0,
        legacyMirrorMismatch: invalidWallets.compatibilityMismatch[0]?.count || 0,
    };
    if (report.walletBalances.missingInvalidOrNegative) problems.push('Users have missing, invalid, or negative walletBalanceMinor');
    if (report.walletBalances.legacyMirrorMismatch) problems.push('Legacy money mirror differs from walletBalanceMinor');

    const [invalidLedger] = await WalletLedger.aggregate([{
        $match: { $expr: { $or: [
            { $lte: ['$amountMinor', 0] },
            { $ne: ['$amountMinor', { $trunc: '$amountMinor' }] },
            { $ne: [
                '$balanceAfterMinor',
                { $cond: [
                    { $eq: ['$direction', 'CREDIT'] },
                    { $add: ['$balanceBeforeMinor', '$amountMinor'] },
                    { $subtract: ['$balanceBeforeMinor', '$amountMinor'] },
                ] },
            ] },
        ] } },
    }, { $count: 'count' }]);
    const latestBalanceMismatches = await WalletLedger.aggregate([
        { $sort: { userId: 1, createdAt: -1, _id: -1 } },
        { $group: { _id: '$userId', latest: { $first: '$balanceAfterMinor' } } },
        { $lookup: { from: User.collection.collectionName, localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $match: { $expr: { $ne: ['$latest', '$user.walletBalanceMinor'] } } },
        { $count: 'count' },
    ]);
    report.walletLedger = {
        credits: await WalletLedger.countDocuments({ direction: 'CREDIT' }),
        debits: await WalletLedger.countDocuments({ direction: 'DEBIT' }),
        invalidArithmetic: invalidLedger?.count || 0,
        latestBalanceMismatch: latestBalanceMismatches[0]?.count || 0,
        duplicateIdempotencyKeys: await duplicateGroups(WalletLedger.collection, ['idempotencyKey']),
        duplicateSourceOperations: await duplicateGroups(
            WalletLedger.collection,
            ['userId', 'direction', 'type', 'sourceType', 'sourceId']
        ),
    };
    for (const [key, value] of Object.entries(report.walletLedger)) {
        if (!['credits', 'debits'].includes(key) && value) problems.push(`WalletLedger ${key} is non-zero`);
    }

    const mappingResults = await Promise.all([
        Service.countDocuments({ $or: [{ catalogueServiceId: null }, { catalogueServiceId: { $exists: false } }] }),
        Service.aggregate([
            { $match: { catalogueServiceId: { $ne: null } } },
            { $lookup: { from: CatalogueService.collection.collectionName, localField: 'catalogueServiceId', foreignField: '_id', as: 'catalogue' } },
            { $match: { catalogue: { $size: 0 } } }, { $count: 'count' },
        ]),
        ProviderOffer.aggregate([
            { $lookup: { from: Provider.collection.collectionName, localField: 'providerId', foreignField: '_id', as: 'provider' } },
            { $match: { provider: { $size: 0 } } }, { $count: 'count' },
        ]),
        ProviderOffer.countDocuments({ $or: [{ catalogueServiceId: null }, { catalogueServiceId: { $exists: false } }] }),
        ProviderOffer.aggregate([
            { $match: { catalogueServiceId: { $ne: null } } },
            { $lookup: { from: CatalogueService.collection.collectionName, localField: 'catalogueServiceId', foreignField: '_id', as: 'catalogue' } },
            { $match: { catalogue: { $size: 0 } } }, { $count: 'count' },
        ]),
    ]);
    report.mappings = {
        servicesWithoutCatalogue: mappingResults[0],
        servicesWithMissingCatalogue: mappingResults[1][0]?.count || 0,
        offersWithMissingProvider: mappingResults[2][0]?.count || 0,
        offersWithoutCatalogue: mappingResults[3],
        offersWithMissingCatalogue: mappingResults[4][0]?.count || 0,
        duplicateProviderServiceMappings: await duplicateGroups(ProviderOffer.collection, ['providerId', 'providerServiceId']),
    };
    for (const [key, value] of Object.entries(report.mappings)) {
        // Unmapped provider inventory is allowed until an administrator links
        // it to the customer catalogue. Dangling or duplicate mappings are not.
        if (key !== 'offersWithoutCatalogue' && value) {
            problems.push(`Mapping check ${key} is non-zero`);
        }
    }

    await verifyIndexes(problems, report);
    report.problems = [...new Set(problems)];
    report.ok = report.problems.length === 0;
    return report;
}

async function run() {
    const capturePath = argumentValue('--capture-baseline');
    const baselinePath = argumentValue('--baseline') || process.env.MIGRATION_BASELINE_FILE;
    await connectToDatabase();
    const report = await buildReport();

    if (capturePath) {
        const baseline = {
            capturedAt: new Date().toISOString(),
            counts: report.counts,
            orderIds: await collectIds(Order),
            transactionIds: await collectIds(Transaction),
        };
        const resolved = path.resolve(capturePath);
        fs.writeFileSync(resolved, `${JSON.stringify(baseline, null, 2)}\n`, { flag: 'wx' });
        report.baseline = { mode: 'captured', path: resolved, orders: baseline.orderIds.length, transactions: baseline.transactionIds.length };
    } else if (baselinePath) {
        const baseline = JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf8'));
        const missingOrders = await missingBaselineIds(Order, baseline.orderIds || []);
        const missingTransactions = await missingBaselineIds(Transaction, baseline.transactionIds || []);
        report.baseline = { mode: 'compared', missingOrders, missingTransactions };
        if (report.counts.users < Number(baseline.counts?.users || 0)) report.problems.push('User count fell below baseline');
        if (missingOrders) report.problems.push('Historical orders are missing');
        if (missingTransactions) report.problems.push('Historical transactions are missing');
        report.ok = report.problems.length === 0;
    } else {
        report.baseline = { mode: 'missing' };
        report.problems.push('A pre-migration baseline is required to prove historical preservation');
        report.ok = false;
    }

    console.log(JSON.stringify(report, null, 2));
    if (!capturePath && !report.ok) process.exitCode = 2;
}

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(`Migration verification failed: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(async () => disconnectFromDatabase());
}

module.exports = { buildReport, duplicateGroups, indexSignature, run };
