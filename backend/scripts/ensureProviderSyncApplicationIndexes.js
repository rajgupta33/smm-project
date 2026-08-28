require('dotenv').config();

const ProviderSyncRun = require('../models/ProviderSyncRun');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');

async function run() {
    await connectToDatabase();
    await ProviderSyncRun.createIndexes();
    console.log(JSON.stringify({
        collection: ProviderSyncRun.collection.collectionName,
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
