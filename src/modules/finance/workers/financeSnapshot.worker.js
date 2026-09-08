const { createWorker } = require('../../../config/queue');
const { QUEUE_NAME } = require('../services/financeSnapshotQueue.service');
const financeSnapshotService = require('../services/financeSnapshot.service');
const financeImportRepository = require('../repositories/financeImport.repository');

async function processSnapshotJob(job) {
  const { orderItemId, importBatchId } = job.data;
  try {
    const result = await financeSnapshotService.recalculateOrderItem(
      orderItemId,
      { system: true, worker: true },
    );
    if (importBatchId) {
      await financeImportRepository.markImportBatchRecalculationCompleted(importBatchId, orderItemId);
    }
    return result;
  } catch (error) {
    if (importBatchId && job.attemptsMade >= (job.opts.attempts || 1) - 1) {
      await financeImportRepository.markImportBatchRecalculationFailed(importBatchId, orderItemId, error);
    }
    throw error;
  }
}

function startFinanceSnapshotWorker() {
  return createWorker(QUEUE_NAME, processSnapshotJob, { concurrency: 3 });
}

module.exports = { startFinanceSnapshotWorker };
