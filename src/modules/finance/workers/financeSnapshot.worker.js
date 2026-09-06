const { createWorker } = require('../../../config/queue');
const { QUEUE_NAME } = require('../services/financeSnapshotQueue.service');
const financeSnapshotService = require('../services/financeSnapshot.service');

function startFinanceSnapshotWorker() {
  return createWorker(QUEUE_NAME, (job) => financeSnapshotService.recalculateOrderItem(
    job.data.orderItemId,
    { system: true, worker: true },
  ), { concurrency: 3 });
}

module.exports = { startFinanceSnapshotWorker };
