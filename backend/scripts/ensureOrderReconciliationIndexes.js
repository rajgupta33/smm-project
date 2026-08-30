require('dotenv').config();
require('./migrationSafety');

const OrderReconciliation = require('../models/OrderReconciliation');
const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');

async function run() {
    const applyChanges = process.argv.includes('--apply');
    await connectToDatabase();
    if (!applyChanges) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            collection: OrderReconciliation.collection.collectionName,
            indexes: OrderReconciliation.schema.indexes(),
        }, null, 2));
        return;
    }
    await OrderReconciliation.createCollection().catch((error) => {
        if (error?.code !== 48 && error?.codeName !== 'NamespaceExists') throw error;
    });
    await OrderReconciliation.createIndexes();
    console.log(JSON.stringify({
        collection: OrderReconciliation.collection.collectionName,
        mode: 'apply',
        status: 'order reconciliation collection and indexes ensured',
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
