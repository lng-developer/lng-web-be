const { createWorker } = require('../../../config/queue');
const { QUEUE_NAME } = require('../services/orderRecheckJobQueue.service');
const { processRecheckJob } = require('../services/orderRecheckJob.service');

function startOrderRecheckJobWorker() {
  return createWorker(QUEUE_NAME, (job) => processRecheckJob(job.data.jobId), { concurrency: 2 });
}

module.exports = { startOrderRecheckJobWorker };
