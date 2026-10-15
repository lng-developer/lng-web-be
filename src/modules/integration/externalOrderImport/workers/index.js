const logger = require('../../../../shared/utils/logger');
const { startPostImportMappingWorker } = require('./postImportMapping.worker');
const { startExternalOrderImportWorker } = require('./externalOrderImport.worker');
const { startCustomizationAssetWorker } = require('./customizationAsset.worker');
const { startEtsyListingImageWorker } = require('./etsyListingImage.worker');

function startExternalOrderImportWorkers() {
  const workers = [
    startExternalOrderImportWorker(),
    startCustomizationAssetWorker(),
    startEtsyListingImageWorker(),
    startPostImportMappingWorker(),
  ];
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
