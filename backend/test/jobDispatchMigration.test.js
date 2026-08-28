const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classifyLegacyOrder } = require('../scripts/backfillJobDispatches');

test('only unclaimed legacy order intents are safe to enqueue', () => {
    assert.equal(classifyLegacyOrder({
        lifecycleStatus: 'INTENT_COMMITTED', submissionAttempt: null,
    }), 'QUEUE_SAFE_INTENT');
    assert.equal(classifyLegacyOrder({
        lifecycleStatus: 'INTENT_COMMITTED', submissionAttempt: { outcome: 'STARTED' },
    }), 'RECONCILE_CLAIMED_ATTEMPT');
});

test('claimed legacy submissions require reconciliation instead of enqueue', () => {
    assert.equal(classifyLegacyOrder({
        lifecycleStatus: 'SUBMITTING', submissionAttempt: { outcome: 'STARTED' },
    }), 'RECONCILE_CLAIMED_ATTEMPT');
    assert.equal(classifyLegacyOrder({ lifecycleStatus: 'SUBMITTED' }), 'IGNORE');
});
