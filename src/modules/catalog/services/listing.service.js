const fs = require('fs');
const path = require('path');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const mediaPublic = require('../../media/public');
const shopPublic = require('../../shop/public');
const listingRepository = require('../repositories/listing.repository');
const {
  listingQcStatuses,
  psdTemplateUpload,
  recordStatuses,
  setupStatuses,
} = require('../constants/catalog.constants');
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
const {
  conflict,
  mapDuplicate,
  notFound,
  validationError,
} = require('./catalogError.helpers');

function getOrderPublic() {
  return require('../../order/public');
}

function getDesignPublic() {
  return require('../../design/public');
}

function getProductionPublic() {
  return require('../../production/public');
}

function emptySalesStats() {
  return {
    orderCount: 0,
    orderItemCount: 0,
    quantitySold: 0,
    lastSoldAt: null,
  };
}

async function salesStatsByListingId(listings = []) {
  const ids = [...new Set((listings || [])
    .map((listing) => toPlainId(listing && (listing._id || listing.id)))
    .filter(Boolean))];
  if (!ids.length || typeof getOrderPublic().summarizeSalesByListingIds !== 'function') return new Map();

  let rows = [];
  try {
    rows = await getOrderPublic().summarizeSalesByListingIds(ids);
  } catch (error) {
    logger.warn('Listing sales stats aggregation skipped', { error });
    return new Map();
  }
  return new Map((rows || []).map((row) => [toPlainId(row.listingId), {
    orderCount: row.orderCount || 0,
    orderItemCount: row.orderItemCount || 0,
    quantitySold: row.quantitySold || 0,
    lastSoldAt: row.lastSoldAt || null,
  }]));
}

async function listingResponse(result) {
  const statsById = await salesStatsByListingId(result.items || []);
  return toPaginatedResponse(result, (item) => toListingDto(item, {
    salesStats: statsById.get(toPlainId(item._id || item.id)) || emptySalesStats(),
  }));
}

async function listingDetailResponse(listing) {
  const statsById = await salesStatsByListingId([listing]);
  return toListingDto(listing, {
    detail: true,
    salesStats: statsById.get(toPlainId(listing._id || listing.id)) || emptySalesStats(),
  });
}

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

function normalizeUpper(value) {
  const text = String(value || '').trim().toUpperCase();
  return text || null;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isActiveApprovedListing(listing) {
  return listing
    && listing.status === recordStatuses.ACTIVE
    && listing.qcStatus === listingQcStatuses.APPROVED;
}

async function triggerPsdDesignTaskForManualListing(listing, authContext) {
  const listingId = toPlainId(listing && (listing._id || listing.id));
  if (!listingId || listing.psdStatus !== setupStatuses.MISSING) return;

  try {
    const designPublic = require('../../design/public');
    if (typeof designPublic.createPsdTemplateTaskFromListing === 'function') {
      await designPublic.createPsdTemplateTaskFromListing(listingId, {
        note: 'Auto-created from manual listing missing PSD',
      }, {
        ...(authContext || {}),
        system: true,
        source: 'CATALOG',
      });
    }
  } catch (error) {
    logger.warn('Auto PSD design task trigger skipped from catalog listing create', {
      listingId,
      error,
    });
  }
}

async function listListings(query = {}, authContext = {}) {
  if (authContext.system === true) {
    const result = await listingRepository.list(query);
    return listingResponse(result);
  }

  if (hasGlobalPermission(authContext, CATALOG_READ)) {
    const result = await listingRepository.list(query);
    return listingResponse(result);
  }

  const scopedShopIds = getScopedShopIds(authContext, CATALOG_READ);
  if (scopedShopIds.length === 0) return emptyPaginatedResult(query);
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return emptyPaginatedResult(query);

  const result = await listingRepository.list({
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  });
  return listingResponse(result);
}

function emptyListingSummary() {
  return {
    totalListingCount: 0,
    amazonListingCount: 0,
    etsyListingCount: 0,
    noPsdCount: 0,
    draftCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
  };
}

async function getListingSummary(query = {}, authContext = {}) {
  if (authContext.system === true) {
    return listingRepository.summarize(query);
  }

  if (hasGlobalPermission(authContext, CATALOG_READ)) {
    return listingRepository.summarize(query);
  }

  const scopedShopIds = getScopedShopIds(authContext, CATALOG_READ);
  if (scopedShopIds.length === 0) return emptyListingSummary();
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return emptyListingSummary();

  return listingRepository.summarize({
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  });
}

async function getListing(listingId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await listingRepository.findById(listingId);
  if (!listing) throw notFound('Listing not found');
  assertCanAccessShop(listing.shopId, CATALOG_READ, authContext);
  return listingDetailResponse(listing);
}

async function getListingById(listingId) {
  assertValidObjectId(listingId, 'listingId');
  return listingRepository.findById(listingId);
}

async function getListingsByIds(listingIds = []) {
  const uniqueIds = [...new Set((listingIds || []).filter(Boolean).map(String))];
  uniqueIds.forEach((listingId) => assertValidObjectId(listingId, 'listingId'));
  return listingRepository.findByIds(uniqueIds);
}

async function getListingSummariesByIds(listingIds = []) {
  const uniqueIds = [...new Set((listingIds || []).filter(Boolean).map(String))];
  uniqueIds.forEach((listingId) => assertValidObjectId(listingId, 'listingId'));
  return listingRepository.findSummariesByIds(uniqueIds);
}

async function createListing(payload, authContext = {}) {
  assertCanAccessShop(payload.shopId, CATALOG_WRITE, authContext);
  await Promise.all([
    shopPublic.assertShopIsActive(payload.shopId),
    assertProductTypeGroupActive(payload.productTypeGroupId),
  ]);
  await assertInternalTemplateActive(payload.internalTemplateId, payload.productTypeGroupId);

  try {
    const listing = await listingRepository.create(payload);
    await triggerPsdDesignTaskForManualListing(listing, authContext);
    return toListingDto(listing, { detail: true });
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

function assertDraftListing(listing) {
  if (listing.qcStatus !== listingQcStatuses.DRAFT) {
    throw conflict('Only draft listings can be approved or rejected');
  }
}

async function approveListing(listingId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const existing = await listingRepository.findById(listingId);
  if (!existing) throw notFound('Listing not found');
  assertCanAccessShop(existing.shopId, CATALOG_WRITE, authContext);
  assertDraftListing(existing);

  return toListingDto(await listingRepository.update(listingId, {
    qcStatus: listingQcStatuses.APPROVED,
    approvedBy: authContext.accountId || null,
    approvedAt: new Date(),
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  }), { detail: true });
}

async function rejectListing(listingId, rejectionReason, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const existing = await listingRepository.findById(listingId);
  if (!existing) throw notFound('Listing not found');
  assertCanAccessShop(existing.shopId, CATALOG_WRITE, authContext);
  assertDraftListing(existing);

  return toListingDto(await listingRepository.update(listingId, {
    qcStatus: listingQcStatuses.REJECTED,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: authContext.accountId || null,
    rejectedAt: new Date(),
    rejectionReason,
  }), { detail: true });
}

function validatePsdUpload(file) {
  if (!file || !file.path) {
    throw validationError('PSD template file is required');
  }

  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!psdTemplateUpload.allowedExtensions.includes(extension)) {
    throw validationError('Unsupported PSD template file extension');
  }

  if (file.mimetype && !psdTemplateUpload.allowedMimeTypes.includes(file.mimetype)) {
    throw validationError('Unsupported PSD template MIME type');
  }

  if (file.size > psdTemplateUpload.maxBytes) {
    throw validationError('PSD template file exceeds max size');
  }
}

async function removeTempUpload(file) {
  if (file && file.path) {
    await fs.promises.rm(file.path, { force: true });
  }
}

async function runListingPsdPostActions(listingId, mediaAssetId, authContext = {}) {
  const postActions = {};
  const warnings = [];
  const systemContext = {
    ...(authContext || {}),
    system: true,
    source: 'CATALOG_LISTING_PSD_TEMPLATE',
  };

  try {
    const designPublic = getDesignPublic();
    if (typeof designPublic.resolveActivePsdTaskForListing === 'function') {
      postActions.designTask = await designPublic.resolveActivePsdTaskForListing(
        listingId,
        toPlainId(mediaAssetId),
        systemContext,
      );
    }
  } catch (error) {
    warnings.push({ code: 'PSD_DESIGN_TASK_RESOLVE_FAILED', message: error.message });
    logger.warn('PSD design task resolve skipped after listing PSD upload', { listingId, error });
  }

  try {
    const productionPublic = getProductionPublic();
    if (typeof productionPublic.recheckPsdBlockedTasksByListing === 'function') {
      postActions.productionRecheck = await productionPublic.recheckPsdBlockedTasksByListing(
        listingId,
        systemContext,
      );
    }
  } catch (error) {
    warnings.push({ code: 'PSD_PRODUCTION_RECHECK_FAILED', message: error.message });
    logger.warn('Production PSD blocked recheck skipped after listing PSD upload', { listingId, error });
  }

  return { postActions, warnings };
}

async function uploadListingPsdTemplate(listingId, file, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const existing = await listingRepository.findById(listingId);
  if (!existing) throw notFound('Listing not found');
  assertCanAccessShop(existing.shopId, CATALOG_WRITE, authContext);

  try {
    validatePsdUpload(file);
    const mediaAsset = await mediaPublic.storeAsset({
      stream: fs.createReadStream(file.path),
      filename: file.originalname,
      mimeType: file.mimetype || null,
      sourceUrlRedacted: null,
      sourceUrlHash: null,
      metadata: {
        source: 'CATALOG_LISTING_PSD_TEMPLATE',
        listingId,
      },
      maxBytes: psdTemplateUpload.maxBytes,
    });

    const mediaAssetId = mediaAsset._id || mediaAsset.id;
    const listingDto = toListingDto(await listingRepository.update(listingId, {
      psdTemplateAssetId: mediaAssetId,
      psdStatus: setupStatuses.PRESENT,
    }), { detail: true });
    const postResult = await runListingPsdPostActions(listingId, mediaAssetId, authContext);
    return {
      ...listingDto,
      ...postResult,
    };
  } finally {
    await removeTempUpload(file);
  }
}

async function setListingPsdTemplateAsset(listingId, mediaAssetId) {
  assertValidObjectId(listingId, 'listingId');
  assertValidObjectId(mediaAssetId, 'mediaAssetId');
  const existing = await listingRepository.findById(listingId);
  if (!existing) throw notFound('Listing not found');
  await mediaPublic.assertMediaAssetExists(mediaAssetId);

  return toListingDto(await listingRepository.update(listingId, {
    psdTemplateAssetId: mediaAssetId,
    psdStatus: setupStatuses.PRESENT,
  }), { detail: true });
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

async function findListingForOrderItem(params = {}) {
  const base = {
    shopId: params.shopId,
    salesChannelCode: normalizeUpper(params.salesChannelCode),
    marketplaceCode: normalizeUpper(params.marketplaceCode),
  };
  const asin = normalizeUpper(params.asin);
  const sku = normalizeUpper(params.sku);
  const fallbackSku = normalizeUpper(params.fallbackSku);

  if (asin) {
    const listing = await listingRepository.findByAsin({
      ...base,
      asin,
      includeInactive: false,
    });
    if (isActiveApprovedListing(listing)) return listing;
  }

  for (const candidateSku of [...new Set([sku, fallbackSku].filter(Boolean))]) {
    const listing = await listingRepository.findBySku({
      ...base,
      sku: candidateSku,
      includeInactive: false,
    });
    if (isActiveApprovedListing(listing)) return listing;
  }

  return null;
}

async function findOrCreateListingForOrderItem(payload = {}, authContext = {}) {
  const existing = await findListingForOrderItem(payload);
  if (existing) return existing;

  const shopId = payload.shopId;
  const salesChannelCode = normalizeUpper(payload.salesChannelCode);
  const marketplaceCode = normalizeUpper(payload.marketplaceCode);
  const asin = normalizeUpper(payload.asin);
  const sku = normalizeUpper(payload.sku) || asin;
  const title = normalizeText(payload.title);

  if (!shopId || !salesChannelCode || !marketplaceCode || !sku || !title || !payload.productTypeGroupId) {
    throw validationError('Missing required listing data for order item');
  }

  assertCanAccessShop(shopId, CATALOG_WRITE, authContext);
  await Promise.all([
    shopPublic.assertShopIsActive(shopId),
    assertProductTypeGroupActive(payload.productTypeGroupId),
  ]);
  await assertInternalTemplateActive(payload.internalTemplateId, payload.productTypeGroupId);

  const createPayload = {
    shopId,
    salesChannelCode,
    marketplaceCode,
    sku,
    asin,
    etsyListingId: normalizeText(payload.etsyListingId),
    title,
    productTypeGroupId: payload.productTypeGroupId,
    internalTemplateId: payload.internalTemplateId || null,
    baseCostAmount: 0,
    currency: normalizeUpper(payload.currency) || 'USD',
    costCenterStatus: setupStatuses.MISSING,
    psdStatus: setupStatuses.MISSING,
    status: recordStatuses.ACTIVE,
    qcStatus: listingQcStatuses.APPROVED,
    approvedBy: null,
    approvedAt: new Date(),
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  };

  try {
    return await listingRepository.create(createPayload);
  } catch (error) {
    if (error && error.code === 11000) {
      const raced = await findListingForOrderItem(createPayload);
      if (raced) return raced;
    }
    throw error;
  }
}

async function getInternalTemplateForListing(listingId) {
  const listing = await getListingById(listingId);
  if (!listing || !listing.internalTemplateId) return null;
  return getInternalTemplateById(toPlainId(listing.internalTemplateId));
}

module.exports = {
  listListings,
  getListingSummary,
  getListing,
  getListingById,
  getListingsByIds,
  getListingSummariesByIds,
  createListing,
  updateListing,
  approveListing,
  rejectListing,
  uploadListingPsdTemplate,
  setListingPsdTemplateAsset,
  findListingForOrderItem,
  findListingBySku,
  findOrCreateListingForOrderItem,
  getInternalTemplateForListing,
};
