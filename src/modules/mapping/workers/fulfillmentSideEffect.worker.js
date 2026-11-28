const { createWorker } = require('../../../config/queue');
const { QUEUE_NAME } = require('../services/fulfillmentSideEffectQueue.service');
const { applyFulfillmentSideEffects } = require('../services/fulfillmentPlan.service');
const { processOrder } = require('../services/fulfillmentSideEffectRequest.service');

function startFulfillmentSideEffectWorker() {
  return createWorker(QUEUE_NAME, (job) => job.data.durable
    ? processOrder(job.data.orderId) : applyFulfillmentSideEffects({ ...job.data, strict: true }), { concurrency: 5 });
}

module.exports = { startFulfillmentSideEffectWorker };
