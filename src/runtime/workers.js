const config = require('../config');
const { startFulfillmentSideEffectWorker } = require('../modules/mapping/workers/fulfillmentSideEffect.worker');
const { startFinanceSnapshotWorker } = require('../modules/finance/workers/financeSnapshot.worker');
const { startFinanceImportWorker } = require('../modules/finance/workers/financeImport.worker');
const { startOrderRecheckJobWorker } = require('../modules/order/workers/orderRecheckJob.worker');
const { startExternalOrderImportWorkers } = require('../modules/integration/externalOrderImport/workers');

function startWorkers(registerWorker) {
  const workers = startExternalOrderImportWorkers();
  workers.forEach(registerWorker);
  const startWorkers = [
    startFulfillmentSideEffectWorker,
    startFinanceSnapshotWorker,
    startFinanceImportWorker,
    startOrderRecheckJobWorker,
  ];
  if (config.shipment.trackingQueueEnabled) {
    const { startVendorTrackingWorker } = require('../modules/shipment/workers/vendorTracking.worker');
    startWorkers.push(startVendorTrackingWorker);
  }
  for (const start of startWorkers) {
    const worker = start();
    if (!worker) continue;
    workers.push(worker);
    registerWorker(worker);
  }
  return workers;
}

module.exports = { startWorkers };
