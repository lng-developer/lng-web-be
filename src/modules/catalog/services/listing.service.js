const fs = require('fs');
const path = require('path');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const { hashString } = require('../../../shared/utils/crypto');
const { safeRemoteFetchStream, redactUrl } = require('../../../shared/network/safeRemoteFetchStream');
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

function listingAssetIds(listings = []) {
  return [...new Set((listings || [])
    .flatMap((listing) => [listing?.previewAssetId, listing?.psdTemplateAssetId])
    .map(toPlainId)
    .filter(Boolean))];
}

async function attachAssetRefs(listings = []) {
  const assetIds = listingAssetIds(listings);
  if (!assetIds.length) return listings;

  const assets = await mediaPublic.getAssetsByIds(assetIds);
  const assetById = new Map((assets || []).map((asset) => [toPlainId(asset._id || asset.id), asset]));
  return listings.map((listing) => ({
    ...listing,
    previewAsset: assetById.get(toPlainId(listing.previewAssetId)) || null,
    psdTemplateAsset: assetById.get(toPlainId(listing.psdTemplateAssetId)) || null,
  }));
}

async function attachAssetRef(listing) {
  if (!listing) return listing;
  const [result] = await attachAssetRefs([listing]);
  return result || listing;
}

async function attachShopRefs(listings = []) {
  const shopIds = [...new Set((listings || []).map((listing) => toPlainId(listing?.shopId)).filter(Boolean))];
  if (!shopIds.length || typeof shopPublic.findById !== 'function') return listings;

  const shops = await Promise.all(shopIds.map((shopId) => (
    Promise.resolve(shopPublic.findById(shopId)).catch(() => null)
  )));
  const shopById = new Map(shops.filter(Boolean).map((shop) => [toPlainId(shop._id || shop.id), shop]));

  return listings.map((listing) => ({
    ...listing,
    shop: shopById.get(toPlainId(listing.shopId)) || null,
  }));
}

async function listingResponse(result) {
  const items = await attachShopRefs(await attachAssetRefs(result.items || []));
  const statsById = await salesStatsByListingId(items);
  return toPaginatedResponse({ ...result, items }, (item) => toListingDto(item, {
    salesStats: statsById.get(toPlainId(item._id || item.id)) || emptySalesStats(),
  }));
}

async function listingDetailResponse(listing) {
  const [enriched] = await attachShopRefs([await attachAssetRef(listing)]);
  const statsById = await salesStatsByListingId([enriched]);
  return toListingDto(enriched, {
    detail: true,
    salesStats: statsById.get(toPlainId(enriched._id || enriched.id)) || emptySalesStats(),
  });
}

async function listingDetailResponseWithoutSales(listing) {
  return toListingDto(await attachAssetRef(listing), { detail: true });
}

function sortListingsBySales(items = [], statsById = new Map(), sort = '') {
  const fieldBySort = {
    orderCountDesc: 'orderCount',
    quantitySoldDesc: 'quantitySold',
    lastSoldAtDesc: 'lastSoldAt',
  };
  const field = fieldBySort[sort];
  if (!field) return items;

  return [...items].sort((left, right) => {
    const leftStats = statsById.get(toPlainId(left._id || left.id)) || emptySalesStats();
    const rightStats = statsById.get(toPlainId(right._id || right.id)) || emptySalesStats();
    const leftValue = field === 'lastSoldAt' ? new Date(leftStats[field] || 0).getTime() : Number(leftStats[field]) || 0;
    const rightValue = field === 'lastSoldAt' ? new Date(rightStats[field] || 0).getTime() : Number(rightStats[field]) || 0;
    return rightValue - leftValue;
  });
}

async function listingSalesSortedResponse(query = {}) {
  // ponytail: in-memory sales sort is fine for current catalog volume; move to an aggregation if listings become large.
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 20, 1);
  const allItems = await attachShopRefs(await attachAssetRefs(await listingRepository.listForSalesSort(query)));
  const statsById = await salesStatsByListingId(allItems);
  const sortedItems = sortListingsBySales(allItems, statsById, query.sort);
  const items = sortedItems.slice((page - 1) * limit, page * limit);

  return toPaginatedResponse({ total: sortedItems.length, page, limit, items }, (item) => toListingDto(item, {
    salesStats: statsById.get(toPlainId(item._id || item.id)) || emptySalesStats(),
  }));
}

function mutableListingPatch(patch = {}) {
  const allowedFields = [
    'title',
    'asin',
    'etsyListingId',
    'productTypeGroupId',
    'internalTemplateId',
    'previewAssetId',
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

const LISTING_PREVIEW_MAX_BYTES = 15 * 1024 * 1024;

function filenameFromUrl(value) {
  try {
    const parsed = new URL(value);
    return path.basename(parsed.pathname || '') || 'listing-preview.bin';
  } catch (error) {
    return 'listing-preview.bin';
  }
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
  const useSalesSort = ['orderCountDesc', 'quantitySoldDesc', 'lastSoldAtDesc'].includes(query.sort);

  if (authContext.system === true) {
    if (useSalesSort) return listingSalesSortedResponse(query);
    const result = await listingRepository.list(query);
    return listingResponse(result);
  }

  if (hasGlobalPermission(authContext, CATALOG_READ)) {
    if (useSalesSort) return listingSalesSortedResponse(query);
    const result = await listingRepository.list(query);
    return listingResponse(result);
  }

  const scopedShopIds = getScopedShopIds(authContext, CATALOG_READ);
  if (scopedShopIds.length === 0) return emptyPaginatedResult(query);
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return emptyPaginatedResult(query);

  const scopedQuery = {
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  };
  if (useSalesSort) return listingSalesSortedResponse(scopedQuery);

  const result = await listingRepository.list(scopedQuery);
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
  return attachAssetRef(await listingRepository.findById(listingId));
}

async function getListingsByIds(listingIds = []) {
  const uniqueIds = [...new Set((listingIds || []).filter(Boolean).map(String))];
  uniqueIds.forEach((listingId) => assertValidObjectId(listingId, 'listingId'));
  return attachAssetRefs(await listingRepository.findByIds(uniqueIds));
}

async function getListingSummariesByIds(listingIds = []) {
  const uniqueIds = [...new Set((listingIds || []).filter(Boolean).map(String))];
  uniqueIds.forEach((listingId) => assertValidObjectId(listingId, 'listingId'));
  return attachAssetRefs(await listingRepository.findSummariesByIds(uniqueIds));
}

async function createListing(payload, authContext = {}) {
  assertCanAccessShop(payload.shopId, CATALOG_WRITE, authContext);
  await Promise.all([
    shopPublic.assertShopIsActive(payload.shopId),
    assertProductTypeGroupActive(payload.productTypeGroupId),
  ]);
  await assertInternalTemplateActive(payload.internalTemplateId, payload.productTypeGroupId);
  if (payload.previewAssetId) await mediaPublic.assertMediaAssetExists(payload.previewAssetId);

  try {
    const listing = await listingRepository.create(payload);
    await triggerPsdDesignTaskForManualListing(listing, authContext);
    return listingDetailResponseWithoutSales(listing);
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
  if (updatePatch.previewAssetId) await mediaPublic.assertMediaAssetExists(updatePatch.previewAssetId);

  try {
    return listingDetailResponseWithoutSales(await listingRepository.update(listingId, updatePatch));
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

async function setListingPreviewFromSourceUrl(listingId, sourceUrl, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const existing = await listingRepository.findById(listingId);
  if (!existing) throw notFound('Listing not found');
  assertCanAccessShop(existing.shopId, CATALOG_WRITE, authContext);

  if (existing.previewAssetId) return existing;

  const normalizedSourceUrl = normalizeText(sourceUrl);
  if (!normalizedSourceUrl) throw validationError('preview sourceUrl is required');

  const { stream, metadata } = await safeRemoteFetchStream(normalizedSourceUrl, {
    maxBytes: LISTING_PREVIEW_MAX_BYTES,
  });
  const mediaAsset = await mediaPublic.storeAsset({
    stream,
    filename: filenameFromUrl(normalizedSourceUrl),
    mimeType: metadata.contentType || null,
    sourceUrlRedacted: metadata.finalUrlRedacted || redactUrl(normalizedSourceUrl),
    sourceUrlHash: hashString(normalizedSourceUrl),
    metadata: {
      source: 'LISTING_PREVIEW_IMAGE',
      listingId: toPlainId(listingId),
      classification: metadata.classification || null,
    },
    maxBytes: LISTING_PREVIEW_MAX_BYTES,
  });
  const previewAssetId = mediaAsset._id || mediaAsset.id;

  return listingRepository.update(listingId, { previewAssetId });
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
  setListingPreviewFromSourceUrl,
  findListingForOrderItem,
  findListingBySku,
  findOrCreateListingForOrderItem,
  getInternalTemplateForListing,
};
