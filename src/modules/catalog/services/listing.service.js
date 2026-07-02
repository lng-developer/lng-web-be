const { assertValidObjectId } = require('../../../shared/utils/objectId');
const shopPublic = require('../../shop/public');
const listingRepository = require('../repositories/listing.repository');
const { listingQcStatuses, recordStatuses } = require('../constants/catalog.constants');
const { toListingDto, toPaginatedResponse } = require('../dtos/catalog.dto');
const {
  CATALOG_READ,
  CATALOG_WRITE,
  assertCanAccessShop,
  emptyPaginatedResult,
  getScopedShopIds,
  hasGlobalPermission,
} = require('./catalogAccess.helpers');
const { assertProductTypeGroupActive } = require('./productTypeGroup.service');
const {
  assertInternalTemplateActive,
  getInternalTemplateById,
  toPlainId,
} = require('./internalTemplate.service');
const { mapDuplicate, notFound } = require('./catalogError.helpers');

function mutableListingPatch(patch = {}) {
  const allowedFields = [
    'title',
    'asin',
    'etsyListingId',
    'productTypeGroupId',
    'internalTemplateId',
    'baseCostAmount',
    'currency',
    'costCenterStatus',
    'psdStatus',
    'status',
  ];

  return allowedFields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      result[field] = patch[field];
    }
    return result;
  }, {});
}

async function listListings(query = {}, authContext = {}) {
  if (hasGlobalPermission(authContext, CATALOG_READ)) {
    const result = await listingRepository.list(query);
    return toPaginatedResponse(result, (item) => toListingDto(item));
  }

  const scopedShopIds = getScopedShopIds(authContext, CATALOG_READ);
  if (scopedShopIds.length === 0) return emptyPaginatedResult(query);
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return emptyPaginatedResult(query);

  const result = await listingRepository.list({
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  });
  return toPaginatedResponse(result, (item) => toListingDto(item));
}

async function getListing(listingId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await listingRepository.findById(listingId);
  if (!listing) throw notFound('Listing not found');
  assertCanAccessShop(listing.shopId, CATALOG_READ, authContext);
  return toListingDto(listing, { detail: true });
}

async function getListingById(listingId) {
  assertValidObjectId(listingId, 'listingId');
  return listingRepository.findById(listingId);
}

async function createListing(payload, authContext = {}) {
  assertCanAccessShop(payload.shopId, CATALOG_WRITE, authContext);
  await Promise.all([
    shopPublic.assertShopIsActive(payload.shopId),
    assertProductTypeGroupActive(payload.productTypeGroupId),
  ]);
  await assertInternalTemplateActive(payload.internalTemplateId, payload.productTypeGroupId);

  try {
    return toListingDto(await listingRepository.create(payload), { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Listing SKU already exists for this shop, channel, and marketplace');
  }
}

async function updateListing(listingId, patch, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const updatePatch = mutableListingPatch(patch);
  const existing = await listingRepository.findById(listingId);
  if (!existing) throw notFound('Listing not found');

  assertCanAccessShop(existing.shopId, CATALOG_WRITE, authContext);
  const productTypeGroupId = updatePatch.productTypeGroupId || toPlainId(existing.productTypeGroupId);
  if (updatePatch.productTypeGroupId) await assertProductTypeGroupActive(updatePatch.productTypeGroupId);
  if (Object.prototype.hasOwnProperty.call(updatePatch, 'internalTemplateId')) {
    await assertInternalTemplateActive(updatePatch.internalTemplateId, productTypeGroupId);
  } else if (updatePatch.productTypeGroupId && existing.internalTemplateId) {
    await assertInternalTemplateActive(toPlainId(existing.internalTemplateId), productTypeGroupId);
  }

  try {
    return toListingDto(await listingRepository.update(listingId, updatePatch), { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Listing SKU already exists for this shop, channel, and marketplace');
  }
}

async function findListingBySku(params = {}) {
  const listing = await listingRepository.findBySku({
    shopId: params.shopId,
    salesChannelCode: params.salesChannelCode && String(params.salesChannelCode).trim().toUpperCase(),
    marketplaceCode: params.marketplaceCode && String(params.marketplaceCode).trim().toUpperCase(),
    sku: params.sku && String(params.sku).trim().toUpperCase(),
    includeInactive: false,
  });
  return listing
    && listing.status === recordStatuses.ACTIVE
    && listing.qcStatus === listingQcStatuses.APPROVED
    ? listing
    : null;
}

async function getInternalTemplateForListing(listingId) {
  const listing = await getListingById(listingId);
  if (!listing || !listing.internalTemplateId) return null;
  return getInternalTemplateById(toPlainId(listing.internalTemplateId));
}

module.exports = {
  listListings,
  getListing,
  getListingById,
  createListing,
  updateListing,
  findListingBySku,
  getInternalTemplateForListing,
};
