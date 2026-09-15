const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { toPaginatedResponse } = require('../../../shared/utils/pagination');
const catalogPublic = require('../../catalog/public');
const shopPublic = require('../../shop/public');
const repository = require('../repositories/listingLaunch.repository');
const { states, salesChannelCode } = require('../constants/listingLaunch.constants');
const { toListingLaunchDto } = require('../dtos/listingLaunch.dto');
const { CATALOG_READ, CATALOG_WRITE, assertCanAccessShop, hasGlobalPermission, getScopedShopIds } = require('./listingLaunchAccess.helpers');

function notFound(message = 'Listing launch not found') {
  return new AppError(message, 404, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict(message) {
  return new AppError(message, 409, true, errorCodes.CONFLICT_ERROR);
}

async function findAccessibleLaunch(id, permission, auth) {
  assertValidObjectId(id);
  const launch = await repository.findById(id);
  if (!launch) throw notFound();
  assertCanAccessShop(launch.shopId, permission, auth);
  return launch;
}

async function createListingLaunch(payload, auth = {}) {
  assertValidObjectId(payload.shopId, 'shopId');
  assertCanAccessShop(payload.shopId, CATALOG_WRITE, auth);
  await shopPublic.assertShopIsActive(payload.shopId);
  return toListingLaunchDto(await repository.create({
    shopId: payload.shopId,
    salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    brief: payload.brief,
    workingTitle: payload.workingTitle,
    referenceAssetIds: payload.referenceAssetIds,
    createdBy: auth.accountId || null,
    state: states.BRIEF,
  }));
}

async function listListingLaunches(query = {}, auth = {}) {
  if (query.shopId) {
    assertValidObjectId(query.shopId, 'shopId');
    assertCanAccessShop(query.shopId, CATALOG_READ, auth);
  }
  const result = await repository.list({
    shopId: query.shopId, state: query.state, page: query.page, limit: query.limit,
    shopIds: hasGlobalPermission(auth, CATALOG_READ) ? undefined : getScopedShopIds(auth, CATALOG_READ),
  });
  return toPaginatedResponse(result, toListingLaunchDto);
}

async function getListingLaunch(id, auth) {
  return toListingLaunchDto(await findAccessibleLaunch(id, CATALOG_READ, auth));
}

async function updateListingLaunch(id, payload, auth) {
  await findAccessibleLaunch(id, CATALOG_WRITE, auth);
  const patch = {};
  for (const key of ['brief', 'workingTitle', 'referenceAssetIds']) {
    if (Object.hasOwn(payload, key)) patch[key] = payload[key];
  }
  const launch = await repository.update(id, patch);
  if (!launch) throw notFound();
  return toListingLaunchDto(launch);
}

async function selectProduct(id, payload, auth = {}) {
  const launch = await findAccessibleLaunch(id, CATALOG_WRITE, auth);
  if (launch.state !== states.BRIEF) throw conflict('Product has already been selected');
  const { productTypeGroupId, internalTemplateId } = payload;
  assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  assertValidObjectId(internalTemplateId, 'internalTemplateId');
  const [group, template] = await Promise.all([
    catalogPublic.getProductTypeGroupById(productTypeGroupId),
    catalogPublic.getInternalTemplateById(internalTemplateId),
  ]);
  if (!group) throw notFound('Product type group not found');
  if (group.status !== 'ACTIVE') throw conflict('Product type group is not active');
  if (!template) throw notFound('Active internal template not found');
  if (template.status !== 'ACTIVE') throw conflict('Internal template is not active');
  if (String(template.productTypeGroupId?._id || template.productTypeGroupId).toLowerCase() !== String(productTypeGroupId).toLowerCase()) {
    throw conflict('Internal template does not belong to the selected product type group');
  }
  const selected = await repository.selectProduct(id, {
    productTypeGroupId, internalTemplateId, selectedBy: auth.accountId || null, selectedAt: new Date(),
  });
  if (!selected) throw conflict('Product selection changed; reload the listing launch');
  return toListingLaunchDto(selected);
}

module.exports = { createListingLaunch, listListingLaunches, getListingLaunch, updateListingLaunch, selectProduct };
