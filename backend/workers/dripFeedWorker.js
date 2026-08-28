const { processDripFeedRun } = require('../services/dripFeedService');

async function processDripFeedRunJob(data, overrides = {}) {
    if (!data?.runId) throw new Error('Drip-feed job requires runId');
    return processDripFeedRun(data.runId, overrides);
}

module.exports = { processDripFeedRunJob };

