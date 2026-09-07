const config = require('../../../config');
const { createQueue } = require('../../../config/queue');
const logger = require('../../../shared/utils/logger');

const QUEUE_NAME = 'finance-snapshot-recalculation';
let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function enqueueSnapshotRecalculation({ orderItemId, reason }) {
  if (!config.redis.enabled) return { queued: false };
  try {
    const job = await getQueue().add('recalculate', { orderItemId, reason }, {
      jobId: `finance-snapshot-${orderItemId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { queued: true, jobId: String(job.id) };
  } catch (error) {
    logger.warn('finance_snapshot_queue_unavailable', { orderItemId, reason, error });
    return { queued: false };
  }
}

module.exports = { QUEUE_NAME, enqueueSnapshotRecalculation };
