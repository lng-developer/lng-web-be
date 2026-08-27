const { createWorker } = require('../../../config/queue');
const { QUEUE_NAME } = require('../services/fulfillmentSideEffectQueue.service');
const { applyFulfillmentSideEffects } = require('../services/fulfillmentPlan.service');

function startFulfillmentSideEffectWorker() {
  return createWorker(QUEUE_NAME, (job) => applyFulfillmentSideEffects(job.data), { concurrency: 5 });
}

module.exports = { startFulfillmentSideEffectWorker };
