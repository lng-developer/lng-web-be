const { createWorker } = require('../../../../config/queue');
const { QUEUE_NAME } = require('../services/customizationAssetQueue.service');
const { processCustomizationAssets } = require('../services/customizationAssetProcessor.service');

async function processCustomizationAssetJob(job) {
  const attempts = job && job.opts && job.opts.attempts ? job.opts.attempts : 1;
  return processCustomizationAssets(job.data || {}, {
    isFinalAttempt: ((job && job.attemptsMade) || 0) + 1 >= attempts,
  });
}

function startCustomizationAssetWorker() {
  return createWorker(QUEUE_NAME, processCustomizationAssetJob, { concurrency: 3 });
}

module.exports = {
  processCustomizationAssetJob,
  startCustomizationAssetWorker,
};
