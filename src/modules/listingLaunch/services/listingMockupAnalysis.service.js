const crypto = require('node:crypto');
const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const media = require('../../media/public');
const shop = require('../../shop/public');
const repository = require('../repositories/listingMockupAnalysis.repository');
const { CATALOG_READ, CATALOG_WRITE, findAccessibleLaunch } = require('./listingLaunchAccess.helpers');
const { toAnalysisDto } = require('../dtos/listingMockupAnalysis.dto');

function assertSourceAsset(asset, launch) {
  if (!asset || asset.provider !== 'cloudinary' || asset.deliveryType !== 'authenticated' || asset.uploadStatus !== 'READY' || asset.discardedAt
    || asset.ownerType !== 'LISTING_LAUNCH' || String(asset.ownerId) !== String(launch._id) || String(asset.shopId) !== String(launch.shopId)
    || String(asset._id) !== String(launch.mockupAssetId) || !/^[a-f\d]{64}$/.test(asset.sha256 || '') || asset.mimeType !== 'image/jpeg') {
    throw new AppError('Mockup asset is unavailable or changed', 409, true, 'MOCKUP_ASSET_CHANGED');
  }
}
async function requestAnalysis(id, command, auth) {
  const launch = await findAccessibleLaunch(id, CATALOG_WRITE, auth);
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ launchId: String(launch._id), expectedMockupRevision: command.expectedMockupRevision })).digest('hex');
  const previous = await repository.findByRequestKey(id, command.requestKey);
  if (previous) { const replay = repository.replayRun(previous, requestHash); return { ...replay, run: toAnalysisDto(replay.run, launch) }; }
  await shop.assertShopIsActive(String(launch.shopId));
  if (launch.state !== 'PRODUCT_SELECTED' || !launch.mockupAssetId || launch.mockupRevision !== command.expectedMockupRevision) throw new AppError('Mockup changed; reload draft', 409, true, 'MOCKUP_INPUT_CHANGED');
  if (!config.listingMockupAnalysis?.enabled || !config.listingMockupAnalysis.model || !config.listingContent.apiKey) throw new AppError('Mockup analysis is not configured', 503, true, 'MOCKUP_ANALYSIS_UNAVAILABLE');
  const asset = await media.getAsset(String(launch.mockupAssetId));
  assertSourceAsset(asset, launch);
  const result = await repository.reserveAnalysis({ launchId: launch._id, shopId: launch.shopId, requestKey: command.requestKey, requestHash,
    assetId: asset._id, assetHash: asset.sha256, mockupRevision: launch.mockupRevision, requestedBy: auth.accountId,
    provider: 'OPENAI', model: config.listingMockupAnalysis.model, promptVersion: 1 });
  const dispatchWarning = result.replayed ? null : await require('./listingMockupProcessing.service').dispatchAnalysis(String(result.run._id));
  if (dispatchWarning) { result.run.errorCode = 'MOCKUP_DISPATCH_PENDING'; result.run.errorMessage = dispatchWarning; }
  return { ...result, run: toAnalysisDto(result.run, launch), ...(dispatchWarning ? { dispatchWarning } : {}) };
}
async function getAnalysis(id, runId, auth) {
  const launch = await findAccessibleLaunch(id, CATALOG_READ, auth);
  assertValidObjectId(runId, 'runId');
  const run = await repository.findById(id, runId);
  if (!run) throw new AppError('Analysis not found', 404, true, 'RESOURCE_NOT_FOUND');
  return toAnalysisDto(run, launch);
}
async function getLatestAnalysis(launch) {
  return launch.latestMockupAnalysisRunId ? toAnalysisDto(await repository.findById(launch._id, launch.latestMockupAnalysisRunId), launch) : null;
}
module.exports = { requestAnalysis, getAnalysis, getLatestAnalysis, assertSourceAsset };
