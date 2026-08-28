const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classifyLegacyDripFeed } = require('../scripts/migrateDripFeedState');

test('drip-feed migration never automatically resumes ambiguous legacy schedules', () => {
    assert.equal(classifyLegacyDripFeed({ status: 'ACTIVE' }), 'LEGACY_RECONCILIATION_REQUIRED');
    assert.equal(classifyLegacyDripFeed({ status: 'ERROR' }), 'LEGACY_RECONCILIATION_REQUIRED');
    assert.equal(classifyLegacyDripFeed({ status: 'COMPLETED' }), 'LEGACY_TERMINAL');
    assert.equal(classifyLegacyDripFeed({ status: 'ACTIVE', workflowVersion: 2 }), 'CURRENT');
});
