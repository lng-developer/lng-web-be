const config = require('../../../config');
const { createQueue } = require('../../../config/queue');

const QUEUE_NAME = 'finance-import';
let queue;

function getQueue() {
  if (!config.redis.enabled) throw new Error('Finance import queue is disabled');
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function enqueueFinanceImport({ batchId }) {
  const job = await getQueue().add('import', { batchId: String(batchId) }, {
    jobId: `finance-import-${batchId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  });
  return { queued: true, jobId: String(job.id) };
}

module.exports = { QUEUE_NAME, enqueueFinanceImport };
