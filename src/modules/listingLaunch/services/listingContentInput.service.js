const crypto = require('crypto');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const repository = require('../repositories/listingLaunch.repository');
const { states } = require('../constants/listingLaunch.constants');
const { listingContentProfile } = require('../constants/listingContentProfile');
const { toListingLaunchDto } = require('../dtos/listingLaunch.dto');
const { findAccessibleLaunch, CATALOG_WRITE } = require('./listingLaunchAccess.helpers');

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

  const contentInputs = {
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
  const saved = await repository.saveContentInputs(launchId, payload.expectedInputVersion, contentInputs);
  if (!saved) throw conflict('Content inputs changed; reload the listing launch');
  return toListingLaunchDto(saved);
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
  };
}

function hashContentSnapshot(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

module.exports = { saveContentInputs, buildContentSnapshot, hashContentSnapshot };
