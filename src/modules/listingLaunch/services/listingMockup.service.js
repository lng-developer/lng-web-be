const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const media = require('../../media/public');
const shop = require('../../shop/public');
const AppError = require('../../../shared/errors/appError');
const logger = require('../../../shared/utils/logger');
const repository = require('../repositories/listingLaunch.repository');
const { CATALOG_WRITE, findAccessibleLaunch } = require('./listingLaunchAccess.helpers');
const { toListingLaunchDto } = require('../dtos/listingLaunch.dto');
const { normalizeMockup } = require('./mockupImage');
const { maxBytes } = require('../constants/listingMockup.constants');

const changed = () => new AppError('Mockup or content inputs changed; reload the draft', 409, true, 'MOCKUP_INPUT_CHANGED');
async function assertUploadAllowed(id, auth) {
  const launch = await findAccessibleLaunch(id, CATALOG_WRITE, auth);
  await shop.assertShopIsActive(String(launch.shopId));
  if (launch.state !== 'PRODUCT_SELECTED') throw changed();
  media.assertAuthenticatedCloudinaryReady();
  return launch;
}

function mockupDto(launch, asset) {
  if (!asset) return null;
  return { assetId: String(asset._id), revision: launch.mockupRevision ?? 0,
    width: asset.metadata?.width, height: asset.metadata?.height, size: asset.size,
    downloadUrl: `/api/media/assets/${asset._id}/download` };
}

async function getMockupSummary(launch) {
  return { mockup: launch.mockupAssetId ? mockupDto(launch, await media.getAsset(String(launch.mockupAssetId))) : null,
    latestMockupAnalysis: await require('./listingMockupAnalysis.service').getLatestAnalysis(launch),
    mockupConfirmationUsable: await getMockupConfirmationUsability(launch) };
}

const confirmationRequired = () => new AppError('Confirm the current mockup observations before generating content', 409, true, 'MOCKUP_CONFIRMATION_REQUIRED');
async function confirmedDesignContext(launch, review, auth) {
  if (!launch.mockupAssetId) { if (review) throw confirmationRequired(); return undefined; }
  if (!review || review.mockupConfirmed !== true || !review.designDescription?.trim()) throw confirmationRequired();
  const run = await require('../repositories/listingMockupAnalysis.repository').findById(launch._id, review.sourceAnalysisRunId);
  if (!run || run.status !== 'SUCCEEDED' || String(run.shopId) !== String(launch.shopId) || String(run.assetId) !== String(launch.mockupAssetId) || run.mockupRevision !== launch.mockupRevision) throw confirmationRequired();
  const asset = await media.getAsset(String(run.assetId));
  require('./listingMockupAnalysis.service').assertSourceAsset(asset, launch);
  if (asset.sha256 !== run.assetHash) throw confirmationRequired();
  await shop.assertShopIsActive(String(launch.shopId));
  return { sourceAnalysisRunId: run._id, assetId: run.assetId, assetHash: run.assetHash, mockupRevision: run.mockupRevision,
    detectedText: review.detectedText, theme: review.theme, designDescription: review.designDescription.trim(), confirmedBy: auth.accountId, confirmedAt: new Date() };
}
async function getMockupConfirmationUsability(launch) {
  if (!launch.mockupAssetId) return false;
  const ctx = launch.contentInputs?.designContext;
  if (!ctx || String(ctx.assetId) !== String(launch.mockupAssetId) || ctx.mockupRevision !== launch.mockupRevision || !ctx.designDescription?.trim()) return false;
  const run = await require('../repositories/listingMockupAnalysis.repository').findById(launch._id, ctx.sourceAnalysisRunId);
  if (!run || run.status !== 'SUCCEEDED' || String(run.assetId) !== String(ctx.assetId) || run.assetHash !== ctx.assetHash || run.mockupRevision !== ctx.mockupRevision) return false;
  const asset = await media.getAsset(String(ctx.assetId));
  try { require('./listingMockupAnalysis.service').assertSourceAsset(asset, launch); } catch { return false; }
  return asset.sha256 === ctx.assetHash;
}

async function uploadMockup(id, file, command, auth) {
  const launch = await assertUploadAllowed(id, auth);
  if ((launch.mockupRevision ?? 0) !== command.expectedMockupRevision || (launch.contentInputVersion ?? 0) !== command.expectedInputVersion) throw changed();
  const normalized = await normalizeMockup(file);
  const uploadMarker = crypto.randomUUID();
  const asset = await media.storeAsset({ stream: Readable.from(normalized.buffer), filename: normalized.filename,
    mimeType: normalized.mimeType, maxBytes, storageProvider: 'cloudinary', deliveryType: 'authenticated',
    ownerType: 'LISTING_LAUNCH', ownerId: launch._id, shopId: launch.shopId, uploadedBy: auth.accountId,
    metadata: { uploadMarker, width: normalized.width, height: normalized.height } });
  let updated;
  try { updated = await repository.replaceMockup(id, { ...command, assetId: asset._id }); }
  catch {
    // An uncertain write may already have attached the asset. Read back before cleanup.
    try {
      const current = await repository.findById(id);
      if (String(current?.mockupAssetId) === String(asset._id)) updated = current;
      else logger.warn('mockup_attachment_reconciliation_required', { assetId: String(asset._id) });
    } catch { logger.warn('mockup_attachment_reconciliation_required', { assetId: String(asset._id) }); }
    if (!updated) throw new AppError('Unable to confirm mockup attachment; reload the draft', 503, true, 'MOCKUP_STORAGE_UNAVAILABLE');
  }
  if (!updated) {
    try { await media.discardUnattachedAsset(asset._id, { uploadMarker }, 'Mockup replacement conflict'); }
    catch { logger.warn('mockup_attachment_reconciliation_required', { assetId: String(asset._id) }); }
    throw changed();
  }
  return toListingLaunchDto(updated, { mockup: mockupDto(updated, asset) });
}
module.exports = { assertUploadAllowed, uploadMockup, getMockupSummary, confirmedDesignContext, getMockupConfirmationUsability, confirmationRequired };
