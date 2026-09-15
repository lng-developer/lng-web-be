const crypto = require('crypto');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const repository = require('../repositories/listingLaunch.repository');
const { states } = require('../constants/listingLaunch.constants');
const { listingContentProfile } = require('../constants/listingContentProfile');
const { toListingLaunchDto } = require('../dtos/listingLaunch.dto');
const { findAccessibleLaunch, CATALOG_WRITE } = require('./listingLaunchAccess.helpers');
const { confirmedDesignContext, getMockupSummary } = require('./listingMockup.service');

function conflict(message) {
  return new AppError(message, 409, true, errorCodes.CONFLICT_ERROR);
}

function validationError(message) {
  return new AppError(message, 400, true, errorCodes.VALIDATION_ERROR);
}

async function saveContentInputs(launchId, payload, auth = {}) {
  assertValidObjectId(launchId);
  const launch = await findAccessibleLaunch(launchId, CATALOG_WRITE, auth);
  if (launch.state !== states.PRODUCT_SELECTED) throw conflict('Select a product before saving content inputs');
  if (launch.marketplaceCode !== listingContentProfile.marketplaceCode) throw conflict('Content profile is not supported for this marketplace');
  if (payload.profileCode !== listingContentProfile.code) throw conflict('Content profile is not supported');
  if (payload.factsConfirmed !== true) throw validationError('Product facts must be confirmed');
  if (!Number.isInteger(payload.expectedInputVersion) || payload.expectedInputVersion < 0) {
    throw validationError('expectedInputVersion must be a non-negative integer');
  }

  const designContext = await confirmedDesignContext(launch, payload.mockupReview, auth);
  const contentInputs = {
    ...(designContext ? { designContext } : {}),
    profileCode: payload.profileCode,
    keyword: payload.keyword,
    language: payload.language,
    productFacts: {
      brand: payload.productFacts?.brand,
      productName: payload.productFacts?.productName,
      material: payload.productFacts?.material,
      features: payload.productFacts?.features,
      ...(Object.hasOwn(payload.productFacts || {}, 'personalization') && { personalization: payload.productFacts.personalization }),
      ...(Object.hasOwn(payload.productFacts || {}, 'careInstructions') && { careInstructions: payload.productFacts.careInstructions }),
    },
    availableColors: payload.availableColors,
    factsConfirmed: true,
    confirmedBy: auth.accountId,
    confirmedAt: new Date(),
  };
  const image = launch.mockupAssetId ? { mockupAssetId: launch.mockupAssetId, mockupRevision: launch.mockupRevision } : {};
  const saved = await repository.saveContentInputs(launchId, payload.expectedInputVersion, contentInputs, image);
  if (!saved) throw conflict('Content inputs changed; reload the listing launch');
  return toListingLaunchDto(saved, await getMockupSummary(saved));
}

function buildContentSnapshot(launch, { productTypeGroup, internalTemplate }) {
  const { contentInputs } = launch;
  return {
    profileCode: contentInputs.profileCode,
    profileVersion: listingContentProfile.version,
    marketplaceCode: launch.marketplaceCode,
    brief: launch.brief,
    productTypeGroupId: String(launch.productTypeGroupId),
    internalTemplateId: String(launch.internalTemplateId),
    keyword: contentInputs.keyword,
    language: contentInputs.language,
    productFacts: {
      brand: contentInputs.productFacts.brand,
      productName: contentInputs.productFacts.productName,
      material: contentInputs.productFacts.material,
      features: [...contentInputs.productFacts.features],
      personalization: contentInputs.productFacts.personalization ?? null,
      careInstructions: contentInputs.productFacts.careInstructions ?? null,
    },
    availableColors: contentInputs.availableColors.map(({ code, label }) => ({ code, label })),
    catalog: {
      productTypeGroup: {
        code: productTypeGroup.code,
        name: productTypeGroup.name,
        printMethod: productTypeGroup.printMethod ?? null,
      },
      internalTemplate: { code: internalTemplate.code, name: internalTemplate.name },
    },
    ...(contentInputs.designContext ? { designContext: designContextSnapshot(contentInputs.designContext) } : {}),
  };
}

function designContextSnapshot(ctx) {
  return { sourceAnalysisRunId: String(ctx.sourceAnalysisRunId), assetId: String(ctx.assetId), assetHash: ctx.assetHash,
    mockupRevision: ctx.mockupRevision, detectedText: ctx.detectedText, theme: ctx.theme, designDescription: ctx.designDescription,
    confirmedBy: String(ctx.confirmedBy), confirmedAt: new Date(ctx.confirmedAt).toISOString() };
}

function hashContentSnapshot(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

module.exports = { saveContentInputs, buildContentSnapshot, hashContentSnapshot };
