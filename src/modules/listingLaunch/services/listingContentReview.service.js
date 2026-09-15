const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { toPaginatedResponse } = require('../../../shared/utils/pagination');
const repository = require('../repositories/listingContent.repository');
const launchRepository = require('../repositories/listingLaunch.repository');
const { listingContentProfile } = require('../constants/listingContentProfile');
const { toListingContentRunDto, toListingContentVersionDto } = require('../dtos/listingContent.dto');
const { toListingLaunchDto } = require('../dtos/listingLaunch.dto');
const { CATALOG_READ, CATALOG_WRITE, findAccessibleLaunch } = require('./listingLaunchAccess.helpers');
const { buildContentSnapshot, hashContentSnapshot } = require('./listingContentInput.service');
const { loadContentCatalogContext } = require('./listingContent.service');
const { validateContent } = require('./listingContentValidation');

const conflict = () => new AppError('Content inputs or Catalog references changed; reload the listing launch', 409, true, errorCodes.CONFLICT_ERROR);

function getContentValidity(launch, version, catalogContext) {
  const current = Boolean(version && catalogContext && launch.contentInputs?.factsConfirmed
    && catalogContext.productTypeGroup?.status === 'ACTIVE' && catalogContext.internalTemplate?.status === 'ACTIVE'
    && String(catalogContext.internalTemplate.productTypeGroupId?._id || catalogContext.internalTemplate.productTypeGroupId)
      .toLowerCase() === String(launch.productTypeGroupId).toLowerCase()
    && launch.state === 'PRODUCT_SELECTED'
    && launch.marketplaceCode === listingContentProfile.marketplaceCode
    && launch.contentInputs.profileCode === listingContentProfile.code
    && String(version.launchId) === String(launch._id)
    && String(version.shopId) === String(launch.shopId)
    && version.inputVersion === (launch.contentInputVersion ?? 0)
    && version.profileVersion === listingContentProfile.version
    && version.inputHash === hashContentSnapshot(buildContentSnapshot(launch, catalogContext)));
  const approval = launch.approvedContent;
  const approvedContentUsable = Boolean(current && approval
    && String(approval.versionId) === String(version._id)
    && approval.inputVersion === version.inputVersion && approval.inputHash === version.inputHash
    && validSelectedColors(approval.selectedColorCodes, launch.contentInputs.availableColors));
  return { isStale: Boolean(version && !current), approvedContentUsable };
}

function validSelectedColors(codes, availableColors) {
  return Array.isArray(codes) && codes.length >= 1 && codes.length <= 30 && new Set(codes).size === codes.length
    && codes.every((code) => availableColors.some((color) => color.code === code));
}

async function historicalCatalogContext(launch) {
  if (!launch.contentInputs) return null;
  try { return await loadContentCatalogContext(launch); }
  catch (error) {
    if (error instanceof AppError && error.isOperational
      && ((error.statusCode === 404 && error.code === errorCodes.RESOURCE_NOT_FOUND)
        || (error.statusCode === 409 && error.code === errorCodes.CONFLICT_ERROR))) return null;
    throw error;
  }
}

async function findVersion(launchId, versionId, session = null) {
  assertValidObjectId(versionId, 'versionId');
  const version = await repository.findVersionById(launchId, versionId, session);
  if (!version) throw new AppError('Content version not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
  return version;
}

async function createContentRevision(launchId, parentVersionId, content, auth = {}) {
  const launch = await findAccessibleLaunch(launchId, CATALOG_WRITE, auth);
  const parent = await findVersion(launchId, parentVersionId);
  const run = await repository.findVersionSnapshot(parent);
  if (!run || parent.profileVersion !== listingContentProfile.version) throw conflict();
  const validated = validateContent(content, run.inputSnapshot);
  const context = await historicalCatalogContext(launch);
  const version = await repository.createRevision({ launchId, shopId: launch.shopId, source: 'MANUAL',
    parentVersionId: parent._id, inputVersion: parent.inputVersion, inputHash: parent.inputHash,
    profileVersion: parent.profileVersion, content: validated, createdBy: auth.accountId });
  return toListingContentVersionDto(version, getContentValidity(launch, version, context));
}

async function approveContent(launchId, versionId, { expectedInputVersion, selectedColorCodes }, auth = {}) {
  return repository.withTransaction(async (session) => {
    const launch = await findAccessibleLaunch(launchId, CATALOG_WRITE, auth, session);
    const version = await findVersion(launchId, versionId, session);
    if (!Number.isInteger(expectedInputVersion) || expectedInputVersion < 0) {
      throw new AppError('expectedInputVersion must be a non-negative integer', 400, true, errorCodes.VALIDATION_ERROR);
    }
    if ((launch.contentInputVersion ?? 0) !== expectedInputVersion) throw conflict();
    const context = await loadContentCatalogContext(launch);
    if (getContentValidity(launch, version, context).isStale) throw conflict();
    validateContent(version.content, buildContentSnapshot(launch, context));
    if (!validSelectedColors(selectedColorCodes, launch.contentInputs.availableColors)) {
      throw new AppError('Select 1–30 distinct available color codes', 400, true, errorCodes.VALIDATION_ERROR);
    }
    const saved = await launchRepository.approveContent(launchId, expectedInputVersion, {
      versionId: version._id, inputVersion: version.inputVersion, inputHash: version.inputHash,
      selectedColorCodes, approvedBy: auth.accountId, approvedAt: new Date(),
    }, session);
    if (!saved) throw conflict();
    return toListingLaunchDto(saved, getContentValidity(saved, version, context));
  });
}

async function listContentVersions(launchId, query = {}, auth = {}) {
  const launch = await findAccessibleLaunch(launchId, CATALOG_READ, auth);
  const [result, context] = await Promise.all([repository.listVersions(launchId, query), historicalCatalogContext(launch)]);
  return toPaginatedResponse(result, (version) => toListingContentVersionDto(version, getContentValidity(launch, version, context)));
}

async function getContentReviewSummary(launch) {
  if (!launch.contentInputs) return { latestRun: null, isStale: false, approvedContentUsable: false };
  const [latestRun, approvedVersion, context] = await Promise.all([
    repository.findLatestRun(launch._id),
    launch.approvedContent ? repository.findVersionById(launch._id, launch.approvedContent.versionId) : null,
    historicalCatalogContext(launch),
  ]);
  const validity = getContentValidity(launch, approvedVersion || latestRun, context);
  // A broken pointer is evidence, never a usable approval.
  if (launch.approvedContent && !approvedVersion) { validity.isStale = true; validity.approvedContentUsable = false; }
  return { latestRun: toListingContentRunDto(latestRun), ...validity };
}

module.exports = { createContentRevision, approveContent, listContentVersions, getContentValidity, getContentReviewSummary };
