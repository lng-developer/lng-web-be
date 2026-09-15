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
  return { mockup: launch.mockupAssetId ? mockupDto(launch, await media.getAsset(String(launch.mockupAssetId))) : null };
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
      else if (current && (current.mockupRevision ?? 0) === command.expectedMockupRevision) {
        await media.discardUnattachedAsset(asset._id, { uploadMarker }, 'Mockup attachment failed');
      } else logger.warn('mockup_attachment_reconciliation_required', { assetId: String(asset._id) });
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
module.exports = { assertUploadAllowed, uploadMockup, getMockupSummary };
