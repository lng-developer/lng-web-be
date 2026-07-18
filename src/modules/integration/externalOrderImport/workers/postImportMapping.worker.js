const { createWorker } = require('../../../../config/queue');
const { QUEUE_NAME } = require('../services/postImportMappingQueue.service');
const { processPostImportMapping } = require('../services/postImportMappingProcessor.service');

async function processPostImportMappingJob(job) {
  const attempts = job?.opts?.attempts || 1;
  return processPostImportMapping(job.data || {}, {
    isFinalAttempt: (job?.attemptsMade || 0) + 1 >= attempts,
  });
}

function startPostImportMappingWorker() {
  return createWorker(QUEUE_NAME, processPostImportMappingJob, { concurrency: 3 });
}

module.exports = {
  processPostImportMappingJob,
  startPostImportMappingWorker,
};
