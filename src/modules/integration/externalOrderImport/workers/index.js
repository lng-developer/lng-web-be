const logger = require('../../../../shared/utils/logger');
const { startPostImportMappingWorker } = require('./postImportMapping.worker');
const { startExternalOrderImportWorker } = require('./externalOrderImport.worker');

function startExternalOrderImportWorkers() {
  const workers = [startExternalOrderImportWorker(), startPostImportMappingWorker()];
  logger.info('external_order_import_workers_started', { count: workers.length });
  return workers;
}

async function stopExternalOrderImportWorkers(workers = []) {
  await Promise.allSettled(workers.map((worker) => worker.close()));
}

module.exports = {
  startExternalOrderImportWorkers,
  stopExternalOrderImportWorkers,
};
