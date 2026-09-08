const { createWorker } = require('../../../config/queue');
const { QUEUE_NAME } = require('../services/financeImportQueue.service');
const financeImportService = require('../services/financeImport.service');

function startFinanceImportWorker() {
  return createWorker(QUEUE_NAME, (job) => financeImportService.processQueuedImportBatch(
    job.data.batchId,
  ), { concurrency: 2 });
}

module.exports = { startFinanceImportWorker };

