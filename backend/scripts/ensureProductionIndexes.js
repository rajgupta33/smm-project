require('dotenv').config();
require('./migrationSafety');

const { connectToDatabase, disconnectFromDatabase } = require('../utils/serverlessDb');

const models = [
    require('../models/AuditLog'),
    require('../models/CatalogueService'),
    require('../models/DripFeedOrder'),
    require('../models/DripFeedRun'),
    require('../models/JobDispatch'),
    require('../models/ManualTask'),
    require('../models/Order'),
    require('../models/OrderEvent'),
    require('../models/OrderReconciliation'),
    require('../models/Payment'),
    require('../models/PaymentWebhookReceipt'),
    require('../models/PricingSettings'),
    require('../models/Provider'),
    require('../models/ProviderOffer'),
    require('../models/ProviderSyncRun'),
    require('../models/RefillRequest'),
    require('../models/Service'),
    require('../models/Ticket'),
    require('../models/TicketMessage'),
    require('../models/Transaction'),
    require('../models/User'),
    require('../models/WalletLedger'),
];

async function run() {
    const applyChanges = process.argv.includes('--apply');
    await connectToDatabase();
    for (const model of models) {
        const report = {
            mode: applyChanges ? 'apply' : 'dry-run',
            model: model.modelName,
            collection: model.collection.collectionName,
            indexes: model.schema.indexes(),
        };
        if (applyChanges) {
            await model.createCollection().catch((error) => {
                if (error?.code !== 48 && error?.codeName !== 'NamespaceExists') throw error;
            });
            await model.createIndexes();
        }
        console.log(JSON.stringify(report));
    }
}

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(async () => disconnectFromDatabase());
}

module.exports = { models, run };
