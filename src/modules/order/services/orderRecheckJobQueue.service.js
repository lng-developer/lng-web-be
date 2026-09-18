const { createQueue } = require('../../../config/queue');

const QUEUE_NAME = 'order-recheck-jobs';
let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function enqueue(jobId) {
  await getQueue().add('recheck', { jobId: String(jobId) }, {
    jobId: `order-recheck-${jobId}`,
    attempts: 1,
    removeOnComplete: 1000,
    removeOnFail: 100,
  });
}

module.exports = { QUEUE_NAME, enqueue };
