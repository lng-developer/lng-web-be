const { createWorker } = require('../../../../config/queue');
const { QUEUE_NAME } = require('../services/externalOrderImportQueue.service');
const externalOrderImportService = require('../services/externalOrderImport.service');

function processExternalOrderImportJob(job) {
  return externalOrderImportService.processImportJob(job.data.jobId, {
    system: true,
    source: 'EXTERNAL_ORDER_IMPORT_WORKER',
  });
}

function startExternalOrderImportWorker() {
  return createWorker(QUEUE_NAME, processExternalOrderImportJob, { concurrency: 1 });
}

module.exports = { processExternalOrderImportJob, startExternalOrderImportWorker };
