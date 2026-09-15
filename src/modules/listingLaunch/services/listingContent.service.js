const crypto = require('crypto');
const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const catalogPublic = require('../../catalog/public');
const shopPublic = require('../../shop/public');
const repository = require('../repositories/listingContent.repository');
const { states } = require('../constants/listingLaunch.constants');
const { listingContentProfile } = require('../constants/listingContentProfile');
const { promptVersion } = require('../constants/listingContent.constants');
const { toListingContentRunDto } = require('../dtos/listingContent.dto');
const { buildContentSnapshot, hashContentSnapshot } = require('./listingContentInput.service');
const { CATALOG_READ, CATALOG_WRITE, findAccessibleLaunch } = require('./listingLaunchAccess.helpers');
const queue = require('../queues/listingContent.queue');
const { dispatchGeneration } = require('./listingContentGeneration.service');

const conflict = (message) => new AppError(message, 409, true, errorCodes.CONFLICT_ERROR);

async function loadContentCatalogContext(launch) {
  await shopPublic.assertShopIsActive(String(launch.shopId));
  const [productTypeGroup, internalTemplate] = await Promise.all([
    catalogPublic.getProductTypeGroupById(String(launch.productTypeGroupId)),
    catalogPublic.getInternalTemplateById(String(launch.internalTemplateId)),
  ]);
  if (!productTypeGroup || productTypeGroup.status !== 'ACTIVE') throw conflict('Product type group is not active');
  if (!internalTemplate || internalTemplate.status !== 'ACTIVE') throw conflict('Internal template is not active');
  if (String(internalTemplate.productTypeGroupId?._id || internalTemplate.productTypeGroupId).toLowerCase()
    !== String(launch.productTypeGroupId).toLowerCase()) {
    throw conflict('Internal template does not belong to the selected product type group');
  }
  return { productTypeGroup, internalTemplate };
}

async function requestGeneration(launchId, command, auth = {}) {
  const launch = await findAccessibleLaunch(launchId, CATALOG_WRITE, auth);
  const { requestKey, expectedInputVersion } = command;
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ requestKey, expectedInputVersion })).digest('hex');
  const previous = await repository.findRunByRequestKey(launchId, requestKey);
  if (previous) {
    const result = repository.replayRun(previous, requestHash);
    return { ...result, run: toListingContentRunDto(result.run) };
  }
  if (launch.state !== states.PRODUCT_SELECTED || !launch.contentInputs?.factsConfirmed) {
    throw conflict('Select a product and save confirmed content inputs before generating');
  }
  if (launch.marketplaceCode !== listingContentProfile.marketplaceCode || launch.contentInputs.profileCode !== listingContentProfile.code) {
    throw conflict('Content profile is not supported for this marketplace');
  }
  if ((launch.contentInputVersion ?? 0) !== expectedInputVersion) throw conflict('Content inputs changed; reload the listing launch');
  if (!config.listingContent?.enabled || !config.listingContent.model || !config.listingContent.apiKey) {
    throw new AppError('Content generation is not configured', 503, true, 'CONTENT_GENERATION_UNAVAILABLE');
  }
  const inputSnapshot = buildContentSnapshot(launch, await loadContentCatalogContext(launch));
  try { await queue.assertQueueReady(); }
  catch { throw new AppError('Content generation queue is unavailable', 503, true, 'CONTENT_GENERATION_UNAVAILABLE'); }
  const result = await repository.reserveGeneration({
    launchId, shopId: launch.shopId, requestKey, requestHash, inputVersion: expectedInputVersion,
    inputSnapshot, inputHash: hashContentSnapshot(inputSnapshot), profileVersion: listingContentProfile.version,
    promptVersion, provider: 'OPENAI', model: config.listingContent.model, requestedBy: auth.accountId,
  });
  const dispatchWarning = !result.replayed ? await dispatchGeneration(String(result.run._id)) : null;
  if (dispatchWarning) {
    result.run.errorCode = 'CONTENT_DISPATCH_PENDING';
    result.run.errorMessage = dispatchWarning;
  }
  return { ...result, run: toListingContentRunDto(result.run), ...(dispatchWarning ? { dispatchWarning } : {}) };
}

async function getGeneration(launchId, runId, auth = {}) {
  await findAccessibleLaunch(launchId, CATALOG_READ, auth);
  assertValidObjectId(runId, 'runId');
  const run = await repository.findRunById(launchId, runId);
  if (!run) throw new AppError('Content generation not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
  return toListingContentRunDto(run);
}

module.exports = { requestGeneration, getGeneration, loadContentCatalogContext };
