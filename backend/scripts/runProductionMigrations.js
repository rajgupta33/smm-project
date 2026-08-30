require('dotenv').config();

const { spawnSync } = require('child_process');
const path = require('path');

const applyChanges = process.argv.includes('--apply');
const migrations = [
    ['wallet-minor-units', 'backfillWalletBalanceMinor.js'],
    ['legacy-service-catalogue', 'mapLegacyServicesToCatalogue.js'],
    ['drip-feed-workflow-v2', 'migrateDripFeedState.js'],
    ['durable-job-dispatch', 'backfillJobDispatches.js'],
    ['provider-sync-application-indexes', 'ensureProviderSyncApplicationIndexes.js'],
    ['order-reconciliation-indexes', 'ensureOrderReconciliationIndexes.js'],
    ['production-model-indexes', 'ensureProductionIndexes.js'],
];

function run() {
    const mode = applyChanges ? 'apply' : 'dry-run';
    console.log(`Production migration sequence (${mode})`);
    for (const [name, filename] of migrations) {
        console.log(`\n[${name}]`);
        const args = [path.join(__dirname, filename), ...(applyChanges ? ['--apply'] : [])];
        const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            throw new Error(`Migration ${name} failed with exit code ${result.status}`);
        }
    }
}

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { migrations, run };
