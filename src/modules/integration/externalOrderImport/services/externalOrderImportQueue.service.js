const { createQueue } = require('../../../../config/queue');
const config = require('../../../../config');

const QUEUE_NAME = 'external-order-import';
let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function enqueueImportJob({ jobId }) {
  if (!config.redis.enabled) throw new Error('Redis queue is disabled');
  await getQueue().add('import-orders', { jobId }, {
    jobId: `external-order-import-${jobId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  });
  return { queued: true, jobId };
}

function resetExternalOrderImportQueueForTest() {
  queue = null;
}

module.exports = { QUEUE_NAME, enqueueImportJob, resetExternalOrderImportQueueForTest };
