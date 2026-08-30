const assert = require('node:assert/strict');
const test = require('node:test');

const { migrations } = require('../scripts/runProductionMigrations');

test('production migrations have an explicit safety-first order', () => {
    assert.deepEqual(migrations.map(([name]) => name), [
        'wallet-minor-units',
        'legacy-service-catalogue',
        'drip-feed-workflow-v2',
        'durable-job-dispatch',
        'provider-sync-application-indexes',
        'order-reconciliation-indexes',
        'production-model-indexes',
    ]);
});
