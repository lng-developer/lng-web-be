const { createQueue, createQueueConnection } = require('../../../config/queue');
const AppError = require('../../../shared/errors/appError');
const logger = require('../../../shared/utils/logger');
const config = require('../../../config');

const queueName = 'listing-launch-content';
let queue;
function getQueue() {
  if (!config.redis?.enabled) throw new AppError('Content generation queue is unavailable', 503, true, 'CONTENT_GENERATION_UNAVAILABLE');
  if (!queue) {
    queue = createQueue(queueName, {
      connection: { ...createQueueConnection(), maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3000, commandTimeout: 3000 },
    });
    queue.on('error', () => logger.warn('listing_content_queue_unavailable'));
  }
  return queue;
}

async function bounded(operation) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new AppError('Content generation queue is unavailable', 503, true, 'CONTENT_GENERATION_UNAVAILABLE')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

function assertQueueReady() {
  return bounded(async () => {
    const client = await getQueue().waitUntilReady();
    await client.ping();
  });
}

function enqueueGeneration(runId) {
  return bounded(async () => {
    const target = getQueue();
    await target.waitUntilReady();
    const existing = await target.getJob(runId);
    if (existing) {
      const state = await existing.getState();
      if (!['completed', 'failed', 'unknown'].includes(state)) return existing;
      // BullMQ rejects removal if another worker has locked the job meanwhile.
      await existing.remove();
    }
    return target.add('generate', { runId }, { jobId: runId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
  });
}

async function closeQueue() {
  const target = queue;
  queue = undefined;
  if (!target) return;
  try { await bounded(() => target.close()); }
  catch { await bounded(() => target.disconnect()); }
}

module.exports = { queueName, getQueue, assertQueueReady, enqueueGeneration, closeQueue };
