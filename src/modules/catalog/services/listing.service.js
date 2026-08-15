const path = require('path');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const mediaPublic = require('../../media/public');
const shopPublic = require('../../shop/public');
const hrPublic = require('../../hr/public');
const listingRepository = require('../repositories/listing.repository');
const listingVariantRepository = require('../repositories/listingVariant.repository');
const productTypeGroupRepository = require('../repositories/productTypeGroup.repository');
const internalTemplateRepository = require('../repositories/internalTemplate.repository');
const {
  listingQcStatuses,
  psdTemplateUpload,
  recordStatuses,
  salesChannelCodes,
  setupStatuses,
} = require('../constants/catalog.constants');
const {
  toInternalTemplateDto,
  toListingDto,
  toPaginatedResponse,
  toProductTypeGroupDto,
} = require('../dtos/catalog.dto');
const {
  CATALOG_READ,
  CATALOG_WRITE,
  assertCanAccessShop,
  emptyPaginatedResult,
  getScopedShopIds,
  hasGlobalPermission,
} = require('./catalogAccess.helpers');
const {
  toPlainId,
} = require('./internalTemplate.service');
const {
  conflict,
  forbidden,
  mapDuplicate,
  notFound,
  validationError,
} = require('./catalogError.helpers');

function getOrderPublic() {
  return require('../../order/public');
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

async function salesStatsByAsin(listings = []) {
  const asins = [...new Set((listings || [])
    .map((listing) => listing && listing.asin)
    .filter(Boolean))];
  if (!asins.length || typeof getOrderPublic().summarizeSalesByAsins !== 'function') return new Map();

  let rows = [];
  try {
    rows = await getOrderPublic().summarizeSalesByAsins(asins);
  } catch (error) {
    logger.warn('Listing ASIN sales stats aggregation skipped', { error });
    return new Map();
  }
  return new Map((rows || []).map((row) => [String(row.asin || '').toUpperCase(), {
    orderCount: row.orderCount || 0,
    orderItemCount: row.orderItemCount || 0,
    quantitySold: row.quantitySold || 0,
    lastSoldAt: row.lastSoldAt || null,
  }]));
}

function activeTemplatePsdAssetId(template = {}) {
  const asset = (template.designAssets || []).find((item) => (
    item
    && item.type === 'PSD_TEMPLATE'
    && item.status !== recordStatuses.INACTIVE
    && item.mediaAssetId
  ));
  return toPlainId(asset?.mediaAssetId);
}

function resolvePsdReadiness(owner = {}, template = null, directSource = 'LISTING_VARIANT', fallbackOwner = null) {
  const activeTemplate = template?.status === recordStatuses.ACTIVE ? template : null;
  const required = activeTemplate?.requiresPsd !== false;
  if (!required) {
    return {
      required: false,
      status: 'NOT_REQUIRED',
      effectivePsdAssetId: null,
      source: null,
    };
  }

  const directAssetId = toPlainId(owner.psdTemplateAssetId);
  if (directAssetId) {
    return {
      required: true,
      status: setupStatuses.PRESENT,
      effectivePsdAssetId: directAssetId,
      source: directSource,
    };
  }

  const fallbackAssetId = toPlainId(fallbackOwner?.defaultPsdTemplateAssetId);
  if (fallbackAssetId) {
    return {
      required: true,
      status: setupStatuses.PRESENT,
      effectivePsdAssetId: fallbackAssetId,
      source: 'LISTING_DEFAULT',
    };
  }

  const templateAssetId = activeTemplatePsdAssetId(activeTemplate || {});
  if (templateAssetId) {
    return {
      required: true,
      status: setupStatuses.PRESENT,
      effectivePsdAssetId: templateAssetId,
      source: 'TEMPLATE',
    };
  }

  return {
    required: true,
    status: setupStatuses.MISSING,
    effectivePsdAssetId: null,
    source: null,
  };
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

function parseEmployeeCodeFromSku(sku) {
  const match = String(sku || '').trim().match(/^(J\d{3,})(?:-|$)/i);
  return match ? match[1].toUpperCase() : null;
}

async function attachSellerRefs(listings = []) {
  const employeeCodes = [...new Set((listings || [])
    .map((listing) => parseEmployeeCodeFromSku(listing?.sku))
    .filter(Boolean)
    .map((employeeCode) => String(employeeCode).toUpperCase()))];

  if (!employeeCodes.length) {
    return listings;
  }

  const profiles = await hrPublic.listEmployeeProfilesByEmployeeCodes(employeeCodes);
  const profileByEmployeeCode = new Map((profiles || [])
    .filter((profile) => profile?.employeeCode)
    .map((profile) => [String(profile.employeeCode).toUpperCase(), profile]));

  return listings.map((listing) => {
    const employeeCode = parseEmployeeCodeFromSku(listing?.sku);
    if (!employeeCode) return listing;

    const profile = profileByEmployeeCode.get(String(employeeCode).toUpperCase());
    return {
      ...listing,
      seller: {
        employeeCode,
        name: profile?.fullName || null,
      },
    };
  });
}

async function listingResponse(result) {
  const items = await attachSellerRefs(await attachShopRefs(result.items || []));
  const listingIds = items.map((item) => item._id || item.id).filter(Boolean);
  const [statsById, statsByAsin, variantCountById, psdStatsById] = await Promise.all([
    salesStatsByListingId(items),
    salesStatsByAsin(items),
    listingVariantRepository.countByListings(listingIds),
    listingVariantRepository.psdStatsByListings(listingIds),
  ]);
  return toPaginatedResponse({ ...result, items }, (item) => toListingDto(item, {
    asinSalesStats: statsByAsin.get(String(item.asin || '').toUpperCase()) || emptySalesStats(),
    psdReadyCount: psdStatsById.get(toPlainId(item._id || item.id))?.ready || 0,
    psdVariantCount: psdStatsById.get(toPlainId(item._id || item.id))?.total || 0,
    salesStats: statsById.get(toPlainId(item._id || item.id)) || emptySalesStats(),
    variantCount: variantCountById.get(toPlainId(item._id || item.id)) || 0,
  }));
}

async function listingDetailResponse(listing) {
  const [enriched] = await attachSellerRefs(await attachShopRefs([listing]));
  const listingId = enriched._id || enriched.id;
  const [statsById, statsByAsin, variantCountById, psdStatsById] = await Promise.all([
    salesStatsByListingId([enriched]),
    salesStatsByAsin([enriched]),
    listingVariantRepository.countByListings([listingId].filter(Boolean)),
    listingVariantRepository.psdStatsByListings([listingId].filter(Boolean)),
  ]);
  return toListingDto(enriched, {
    asinSalesStats: statsByAsin.get(String(enriched.asin || '').toUpperCase()) || emptySalesStats(),
    detail: true,
    psdReadyCount: psdStatsById.get(toPlainId(enriched._id || enriched.id))?.ready || 0,
    psdVariantCount: psdStatsById.get(toPlainId(enriched._id || enriched.id))?.total || 0,
    salesStats: statsById.get(toPlainId(enriched._id || enriched.id)) || emptySalesStats(),
    variantCount: variantCountById.get(toPlainId(enriched._id || enriched.id)) || 0,
  });
}

async function listingDetailResponseWithoutSales(listing) {
  return toListingDto(listing, { detail: true });
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
  const allItems = await attachSellerRefs(
    await attachShopRefs(await listingRepository.listForSalesSort(query)),
  );
  const statsById = await salesStatsByListingId(allItems);
  const statsByAsin = await salesStatsByAsin(allItems);
  const listingIds = allItems.map((item) => item._id || item.id).filter(Boolean);
  const variantCountById = await listingVariantRepository.countByListings(listingIds);
  const psdStatsById = await listingVariantRepository.psdStatsByListings(listingIds);
  const sortedItems = sortListingsBySales(allItems, statsById, query.sort);
  const items = sortedItems.slice((page - 1) * limit, page * limit);

  return toPaginatedResponse({ total: sortedItems.length, page, limit, items }, (item) => toListingDto(item, {
    asinSalesStats: statsByAsin.get(String(item.asin || '').toUpperCase()) || emptySalesStats(),
    psdReadyCount: psdStatsById.get(toPlainId(item._id || item.id))?.ready || 0,
    psdVariantCount: psdStatsById.get(toPlainId(item._id || item.id))?.total || 0,
    salesStats: statsById.get(toPlainId(item._id || item.id)) || emptySalesStats(),
    variantCount: variantCountById.get(toPlainId(item._id || item.id)) || 0,
  }));
}

function mutableListingPatch(patch = {}) {
  const allowedFields = [
    'title',
    'asin',
    'etsyListingId',
    'productImageUrl',
    'defaultPsdTemplateAssetId',
    'baseCostAmount',
    'currency',
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

function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? text : null;
  } catch (error) {
    return null;
  }
}

function isActiveApprovedListing(listing) {
  return listing
    && listing.status === recordStatuses.ACTIVE
    && listing.qcStatus === listingQcStatuses.APPROVED;
}

async function getListingOptions(authContext = {}) {
  const shopIds = canReadCatalogOverview(authContext)
    ? undefined
    : getScopedShopIds(authContext, CATALOG_READ);
  const [shops, productTypeGroups, internalTemplates] = await Promise.all([
    shopPublic.listActiveShops({ shopIds }),
    productTypeGroupRepository.list({ page: 1, limit: 1000, status: recordStatuses.ACTIVE }),
    internalTemplateRepository.list({ page: 1, limit: 1000, status: recordStatuses.ACTIVE }),
  ]);

  return {
    salesChannels: Object.values(salesChannelCodes).map((code) => ({ code, name: code })),
    shops: shops.map((shop) => ({
      id: toPlainId(shop._id || shop.id),
      name: shop.name,
      currency: shop.currency,
      status: shop.status,
    })),
    productTypeGroups: productTypeGroups.items.map(toProductTypeGroupDto),
    internalTemplates: internalTemplates.items.map(toInternalTemplateDto),
  };
}

async function listListings(query = {}, authContext = {}) {
  const useSalesSort = ['orderCountDesc', 'quantitySoldDesc', 'lastSoldAtDesc'].includes(query.sort);

  if (canReadCatalogOverview(authContext)) {
    if (useSalesSort) return listingSalesSortedResponse(query);
    const result = await listingRepository.list(query);
    return listingResponse(result);
  }

  const scopedShopIds = getScopedShopIds(authContext, CATALOG_READ);
  if (scopedShopIds.length === 0) {
    const listingIds = await getAssignedListingIds(authContext);
    if (!listingIds.length) return emptyPaginatedResult(query);
    const result = await listingRepository.list({ ...query, listingIds });
    return listingResponse(result);
  }
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return emptyPaginatedResult(query);

  const scopedQuery = {
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  };
  if (useSalesSort) return listingSalesSortedResponse(scopedQuery);

  const result = await listingRepository.list(scopedQuery);
  return listingResponse(result);
}

function canReadCatalogOverview(authContext = {}) {
  return authContext.system === true || Boolean(authContext.accountId) || hasGlobalPermission(authContext, CATALOG_READ);
}

async function getAssignedListingIds(authContext = {}) {
  const accountIds = await getCatalogReadAccountIds(authContext);
  if (!accountIds.length) return [];
  const orderPublic = getOrderPublic();
  const orderIds = await orderPublic.findAssignedOrderIds(accountIds);
  return orderIds.length ? orderPublic.findListingIdsByOrderIds(orderIds) : [];
}

function getOrganizationPublic() {
  return require('../../organization/public');
}

function scopedTeamIds(authContext = {}, predicate) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => scope.scopeType === 'team' && scope.scopeId && predicate(scope))
    .map((scope) => String(scope.scopeId)))];
}

async function getCatalogReadAccountIds(authContext = {}) {
  if (!authContext.accountId) return [];
  const catalogTeams = scopedTeamIds(authContext, (scope) => (scope.permissions || []).includes(CATALOG_READ));
  const leaderTeams = scopedTeamIds(authContext, (scope) => (scope.roles || []).includes('TEAM_LEADER'));
  const leaderCatalogTeams = catalogTeams.filter((teamId) => leaderTeams.includes(teamId));
  if (!leaderCatalogTeams.length) return [authContext.accountId];

  const organizationPublic = getOrganizationPublic();
  const memberships = await Promise.all(leaderCatalogTeams.map((teamId) => organizationPublic.listTeamMembers(teamId)));
  return [...new Set([
    authContext.accountId,
    ...memberships.flatMap(({ leaders = [], members = [] }) => (
      [...leaders, ...members].map((member) => String(member.accountId)).filter(Boolean)
    )),
  ])];
}

function emptyListingSummary() {
  return {
    totalListingCount: 0,
    amazonListingCount: 0,
    etsyListingCount: 0,
    draftCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    noPsdCount: 0,
    channelCounts: [],
  };
}

async function getListingSummary(query = {}, authContext = {}) {
  let scopedQuery = query;
  if (!canReadCatalogOverview(authContext)) {
    const scopedShopIds = getScopedShopIds(authContext, CATALOG_READ);
    if (scopedShopIds.length === 0) {
      const listingIds = await getAssignedListingIds(authContext);
      return listingIds.length
        ? listingRepository.summarize({ ...query, listingIds })
        : emptyListingSummary();
    }
    if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return emptyListingSummary();
    scopedQuery = {
      ...query,
      shopIds: query.shopId ? [query.shopId] : scopedShopIds,
    };
  }

  return listingRepository.summarize(scopedQuery);
}

async function getListing(listingId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await listingRepository.findById(listingId);
  if (!listing) throw notFound('Listing not found');
  if (!await canReadListing(listing, authContext)) throw forbidden();
  return listingDetailResponse(listing);
}

async function requestListingPsd(listingId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await listingRepository.findById(listingId);
  if (!listing) throw notFound('Listing not found');
  assertCanAccessShop(listing.shopId, CATALOG_WRITE, authContext);
  if (listing.defaultPsdTemplateAssetId) throw conflict('Listing PSD is not missing');

  const designPublic = require('../../design/public');
  return designPublic.createPsdTemplateTaskFromListing(
    listingId,
    { note: 'Requested from Catalog listing' },
    { ...(authContext || {}), system: true, source: 'CATALOG' },
  );
}

async function canReadListing(listing, authContext = {}) {
  try {
    assertCanAccessShop(listing.shopId, CATALOG_READ, authContext);
    return true;
  } catch (error) {
    if (error?.code !== 'AUTHORIZATION_ERROR') throw error;
  }
  return (await getAssignedListingIds(authContext)).some((id) => String(id) === String(listing._id || listing.id));
}

async function canReadAssignedListing(listing, authContext = {}) {
  return (await getAssignedListingIds(authContext)).some((id) => String(id) === String(listing._id || listing.id));
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
  await shopPublic.assertShopIsActive(payload.shopId);
  await assertReadyPsdAsset(payload.defaultPsdTemplateAssetId);

  try {
    return listingDetailResponseWithoutSales(await listingRepository.create(payload));
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
  await assertReadyPsdAsset(updatePatch.defaultPsdTemplateAssetId);
  try {
    return listingDetailResponseWithoutSales(await listingRepository.update(listingId, updatePatch));
  } catch (error) {
    await mapDuplicate(error, 'Listing SKU already exists for this shop, channel, and marketplace');
  }
}

async function recheckAfterListingPsdUpdate(listingId, authContext = {}) {
  const orderPublic = require('../../order/public');
  const productionPublic = require('../../production/public');
  await Promise.all([
    typeof orderPublic.updatePsdStatusesForListing === 'function'
      ? orderPublic.updatePsdStatusesForListing(listingId)
      : Promise.resolve(),
    typeof productionPublic.recheckPsdBlockedTasksByListing === 'function'
      ? productionPublic.recheckPsdBlockedTasksByListing(listingId, {
        ...(authContext || {}),
        system: true,
        source: 'CATALOG_LISTING_PSD',
      })
      : Promise.resolve(),
  ]);
}

async function setListingPsdTemplateAsset(listingId, mediaAssetId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  assertValidObjectId(mediaAssetId, 'mediaAssetId');
  const existing = await listingRepository.findById(listingId);
  if (!existing) throw notFound('Listing not found');
  await assertReadyPsdAsset(mediaAssetId);
  const updated = await listingRepository.update(listingId, { defaultPsdTemplateAssetId: mediaAssetId });
  await recheckAfterListingPsdUpdate(listingId, authContext);
  return listingDetailResponseWithoutSales(updated);
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

function assertPsdAssetShape(asset = {}) {
  const extension = path.extname(asset.originalFilename || '').toLowerCase();
  if (!psdTemplateUpload.allowedExtensions.includes(extension)) {
    throw validationError('PSD template asset must use a PSD-compatible filename');
  }
  if (asset.mimeType && !psdTemplateUpload.allowedMimeTypes.includes(asset.mimeType)) {
    throw validationError('PSD template asset must use a PSD-compatible MIME type');
  }
  if (asset.size > psdTemplateUpload.maxBytes) {
    throw validationError('PSD template asset exceeds max size');
  }
}

async function assertReadyPsdAsset(mediaAssetId) {
  if (!mediaAssetId) return;
  await mediaPublic.assertMediaAssetReady(mediaAssetId);
  assertPsdAssetShape(await mediaPublic.getAsset(mediaAssetId) || {});
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
  const productImageUrl = normalizeUrl(payload.productImageUrl);
  if (existing) {
    if (productImageUrl && !existing.productImageUrl) {
      return listingRepository.update(existing._id || existing.id, { productImageUrl });
    }
    return existing;
  }

  const shopId = payload.shopId;
  const salesChannelCode = normalizeUpper(payload.salesChannelCode);
  const marketplaceCode = normalizeUpper(payload.marketplaceCode);
  const asin = normalizeUpper(payload.asin);
  const sku = normalizeUpper(payload.sku) || asin;
  const title = normalizeText(payload.title);

  if (!shopId || !salesChannelCode || !marketplaceCode || !sku || !title) {
    throw validationError('Missing required listing data for order item');
  }

  assertCanAccessShop(shopId, CATALOG_WRITE, authContext);
  await shopPublic.assertShopIsActive(shopId);

  const createPayload = {
    shopId,
    salesChannelCode,
    marketplaceCode,
    sku,
    asin,
    etsyListingId: normalizeText(payload.etsyListingId),
    title,
    productImageUrl,
    baseCostAmount: 0,
    currency: normalizeUpper(payload.currency) || 'USD',
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
      const base = { shopId, salesChannelCode, marketplaceCode };
      const raced = (asin && await listingRepository.findByAsin({ ...base, asin, includeInactive: true }))
        || await listingRepository.findBySku({ ...base, sku, includeInactive: true });
      if (raced) {
        if (productImageUrl && !raced.productImageUrl) {
          return listingRepository.update(raced._id || raced.id, { productImageUrl });
        }
        return raced;
      }
    }
    throw error;
  }
}

async function findOrCreateDraftListingForOrderItem(payload = {}, authContext = {}) {
  const shopId = payload.shopId;
  const salesChannelCode = normalizeUpper(payload.salesChannelCode);
  const marketplaceCode = normalizeUpper(payload.marketplaceCode);
  const asin = normalizeUpper(payload.asin);
  const sku = normalizeUpper(payload.sku) || asin;
  const title = normalizeText(payload.title);
  const productImageUrl = normalizeUrl(payload.productImageUrl);

  if (!shopId || !salesChannelCode || !marketplaceCode || !sku || !title) {
    throw validationError('Missing required draft listing identity for order item');
  }

  assertCanAccessShop(shopId, CATALOG_WRITE, authContext);
  await shopPublic.assertShopIsActive(shopId);

  const base = { shopId, salesChannelCode, marketplaceCode };
  const existing = (asin && await listingRepository.findByAsin({ ...base, asin, includeInactive: true }))
    || await listingRepository.findBySku({ ...base, sku, includeInactive: true });
  if (existing) {
    if (productImageUrl && !existing.productImageUrl) {
      return listingRepository.update(existing._id || existing.id, { productImageUrl });
    }
    return existing;
  }

  const createPayload = {
    shopId,
    salesChannelCode,
    marketplaceCode,
    sku,
    asin,
    etsyListingId: normalizeText(payload.etsyListingId),
    title,
    productImageUrl,
    baseCostAmount: 0,
    currency: normalizeUpper(payload.currency) || 'USD',
    status: recordStatuses.ACTIVE,
    qcStatus: listingQcStatuses.DRAFT,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  };

  try {
    return await listingRepository.create(createPayload);
  } catch (error) {
    if (error && error.code === 11000) {
      const raced = (asin && await listingRepository.findByAsin({ ...base, asin, includeInactive: true }))
        || await listingRepository.findBySku({ ...base, sku, includeInactive: true });
      if (raced) {
        if (productImageUrl && !raced.productImageUrl) {
          return listingRepository.update(raced._id || raced.id, { productImageUrl });
        }
        return raced;
      }
    }
    throw error;
  }
}

module.exports = {
  assertPsdAssetShape,
  getListingOptions,
  listListings,
  getListingSummary,
  getListing,
  requestListingPsd,
  setListingPsdTemplateAsset,
  canReadAssignedListing,
  canReadListing,
  getListingById,
  getListingsByIds,
  getListingSummariesByIds,
  createListing,
  updateListing,
  approveListing,
  rejectListing,
  findListingForOrderItem,
  findListingBySku,
  findOrCreateListingForOrderItem,
  findOrCreateDraftListingForOrderItem,
  resolvePsdReadiness,
};
