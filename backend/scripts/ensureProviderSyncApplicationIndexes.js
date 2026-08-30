require('dotenv').config();
require('./migrationSafety');

const ProviderSyncRun = require('../models/ProviderSyncRun');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');

async function run() {
    const applyChanges = process.argv.includes('--apply');
    await connectToDatabase();
    if (!applyChanges) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            collection: ProviderSyncRun.collection.collectionName,
            indexes: ProviderSyncRun.schema.indexes(),
        }, null, 2));
        return;
    }
    await ProviderSyncRun.createIndexes();
    console.log(JSON.stringify({
        collection: ProviderSyncRun.collection.collectionName,
        mode: 'apply',
        status: 'provider sync application indexes ensured',
    }, null, 2));
}

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(async () => disconnectFromDatabase());
}

module.exports = { run };
