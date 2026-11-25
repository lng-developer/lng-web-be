const { createQueue } = require('../../../config/queue');
const config = require('../../../config');
const logger = require('../../../shared/utils/logger');
const requestRepository = require('../repositories/fulfillmentSideEffectRequest.repository');

const QUEUE_NAME = 'mapping-fulfillment-side-effects';
let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function enqueueFulfillmentSideEffects(payload) {
  if (config.mapping?.durableSideEffectsEnabled) {
    const request = await requestRepository.request(payload);
    const result = await signalOrder(request);
    return { ...result, durable: true };
  }
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

function signalOrder(request) {
  return signalOrders([request]);
}

async function signalOrders(rows) {
  if (!config.redis.enabled || !rows.length) return { queued: false };
  try {
    await getQueue().addBulk(rows.map(({ orderId, requestedVersion }) => ({
      name: 'apply-order', data: { orderId: String(orderId), durable: true },
      opts: {
        jobId: `mapping-order-${orderId}-${requestedVersion}-${Math.floor(Date.now() / 30000)}`,
        attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: 100,
      },
    })));
    return { queued: true };
  } catch (error) {
    logger.warn('mapping_side_effect_signal_unavailable', { count: rows.length, error });
    return { queued: false };
  }
}

module.exports = { QUEUE_NAME, enqueueFulfillmentSideEffects, signalOrder, signalOrders };
