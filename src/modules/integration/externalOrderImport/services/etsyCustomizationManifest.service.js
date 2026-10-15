const AppError = require('../../../../shared/errors/appError');
const jobs = require('./externalOrderImport.service');
const rawRepository = require('../repositories/externalOrderRawRecord.repository');
const media = require('../../../media/public');
const customization = require('../../../customization/public');
const mappingQueue = require('./postImportMappingQueue.service');

async function authorizedJob(jobId, auth) {
  const job = await jobs.loadAuthorizedImportJob(jobId, 'ORDERS:WRITE', auth);
  if (job.salesChannelCode !== 'ETSY') throw new AppError('Etsy import job required', 400, true, 'VALIDATION_ERROR');
  return job;
}

async function uploadAsset(jobId, file, sha256, auth) {
  const job = await authorizedJob(jobId, auth);
  return media.storeImportAsset({ file, sha256, shopId: job.shopId, jobId });
}

async function attachManifest(jobId, entries, auth) {
  const job = await authorizedJob(jobId, auth);
  const results = [];
  for (const entry of entries) {
    try {
      const record = await rawRepository.findImportedItem(jobId, entry.externalOrderId, entry.externalItemId);
      if (!record) throw new AppError('Imported transaction not found', 400, true, 'VALIDATION_ERROR');
      const assets = [];
      for (const input of entry.assets) {
        const asset = await media.getAsset(input.mediaAssetId);
        if (!asset || String(asset.shopId) !== String(job.shopId) || String(asset.ownerId) !== String(jobId)
          || asset.ownerType !== 'ETSY_IMPORT' || asset.uploadStatus !== 'READY' || asset.discardedAt) {
          throw new AppError('Asset does not belong to this import', 403, true, 'AUTHORIZATION_ERROR');
        }
        assets.push({ mediaAssetId: String(asset._id), filename: asset.originalFilename, contentType: asset.mimeType, sha256: asset.sha256 });
      }
      const payload = await customization.attachEtsyImportAssets(record.orderItemId, assets, auth);
      const queued = await mappingQueue.enqueuePostImportMappingJob({ importJobId: jobId, rawRecordId: String(record._id), rawRecordIds: [String(record._id)], orderId: record.orderId, orderItemId: record.orderItemId, externalOrderId: entry.externalOrderId, externalItemId: entry.externalItemId, source: 'ETSY_MANIFEST' }, { force: true });
      results.push({ externalOrderId: entry.externalOrderId, externalItemId: entry.externalItemId, status: !queued?.queued ? 'retry' : payload.status === 'PARSED' ? 'accepted' : 'needsReview', mappingQueued: Boolean(queued?.queued) });
    } catch (error) {
      results.push({ externalOrderId: entry.externalOrderId, externalItemId: entry.externalItemId, status: 'failed', errorCode: error.code || 'APP_ERROR', errorMessage: error.isOperational ? error.message : 'Could not attach customization assets' });
    }
  }
  return { entries: results };
}

module.exports = { uploadAsset, attachManifest };
