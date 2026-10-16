const { createQueue } = require('../../../config/queue');
const config = require('../../../config');
const logger = require('../../../shared/utils/logger');

const QUEUE_NAME = 'mapping-fulfillment-side-effects';
let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function enqueueFulfillmentSideEffects(payload) {
  if (!config.redis.enabled) return { queued: false };
  try {
    await getQueue().add('apply', payload, {
      jobId: `fulfillment-side-effects-${payload.orderItemId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { queued: true };
  } catch (error) {
    logger.warn('mapping_fulfillment_side_effect_queue_unavailable', { orderItemId: payload.orderItemId, error });
    return { queued: false };
  }
}

module.exports = { QUEUE_NAME, enqueueFulfillmentSideEffects };
