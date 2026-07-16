const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const Listing = require('../models/listing.model');
const {
  listingQcStatuses,
  recordStatuses,
  salesChannelCodes,
  setupStatuses,
} = require('../constants/catalog.constants');

function withProductTypeGroup(query) {
  return query
    .populate({
      path: 'productTypeGroupId',
      select: 'code name status',
    })
    .populate({
      path: 'internalTemplateId',
      select: 'code name status productTypeGroupId',
    });
}

function buildFilter({
  shopId,
  shopIds,
  salesChannelCode,
  marketplaceCode,
  asin,
  etsyListingId,
  search,
  sku,
  status,
  qcStatus,
  productTypeGroupId,
  costCenterStatus,
  psdStatus,
} = {}) {
  const filter = {};
  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length > 0) filter.shopId = { $in: shopIds };
  if (salesChannelCode) filter.salesChannelCode = salesChannelCode;
  if (marketplaceCode) filter.marketplaceCode = marketplaceCode;
  if (status) filter.status = status;
  if (qcStatus) filter.qcStatus = qcStatus;
  if (productTypeGroupId) filter.productTypeGroupId = productTypeGroupId;
  if (costCenterStatus) filter.costCenterStatus = costCenterStatus;
  if (psdStatus) filter.psdStatus = psdStatus;

  const skuRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(sku));
  if (skuRegex) filter.sku = skuRegex;

  const asinRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(asin));
  if (asinRegex) filter.asin = asinRegex;

  const etsyListingIdRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(etsyListingId));
  if (etsyListingIdRegex) filter.etsyListingId = etsyListingIdRegex;

  const searchRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(search));
  if (searchRegex) {
    filter.$or = [
      { asin: searchRegex },
      { sku: searchRegex },
      { title: searchRegex },
    ];
  }

  return filter;
}

async function create(payload) {
  const listing = await Listing.create(payload);
  return withProductTypeGroup(Listing.findById(listing._id)).lean();
}

async function findById(listingId) {
  return withProductTypeGroup(Listing.findById(listingId)).lean();
}

async function findByIds(listingIds = []) {
  if (!listingIds.length) return [];
  return withProductTypeGroup(Listing.find({ _id: { $in: listingIds } })).lean();
}

async function findSummariesByIds(listingIds = []) {
  if (!listingIds.length) return [];
  return withProductTypeGroup(
    Listing.find({ _id: { $in: listingIds } })
      .select('sku asin etsyListingId title productTypeGroupId internalTemplateId psdTemplateAssetId previewAssetId psdStatus costCenterStatus'),
  ).lean();
}

async function findBySku({ shopId, salesChannelCode, marketplaceCode, sku, includeInactive = false } = {}) {
  const filter = {
    shopId,
    salesChannelCode,
    marketplaceCode,
    sku,
  };

  if (!includeInactive) {
    filter.status = recordStatuses.ACTIVE;
    filter.qcStatus = listingQcStatuses.APPROVED;
  }

  return withProductTypeGroup(Listing.findOne(filter)).lean();
}

async function findByAsin({ shopId, salesChannelCode, marketplaceCode, asin, includeInactive = false } = {}) {
  const filter = {
    shopId,
    salesChannelCode,
    marketplaceCode,
    asin,
  };

  if (!includeInactive) {
    filter.status = recordStatuses.ACTIVE;
    filter.qcStatus = listingQcStatuses.APPROVED;
  }

  return withProductTypeGroup(Listing.findOne(filter)).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    withProductTypeGroup(Listing.find(filter))
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Listing.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

function addExactFilter(filter, field, value) {
  if (filter[field] && filter[field] !== value) {
    return { ...filter, _id: null };
  }
  return { ...filter, [field]: value };
}

async function summarize(filters = {}) {
  const filter = buildFilter(filters);
  const [
    totalListingCount,
    amazonListingCount,
    etsyListingCount,
    noPsdCount,
    draftCount,
    approvedCount,
    rejectedCount,
  ] = await Promise.all([
    Listing.countDocuments(filter),
    Listing.countDocuments(addExactFilter(filter, 'salesChannelCode', salesChannelCodes.AMAZON)),
    Listing.countDocuments(addExactFilter(filter, 'salesChannelCode', salesChannelCodes.ETSY)),
    Listing.countDocuments(addExactFilter(filter, 'psdStatus', setupStatuses.MISSING)),
    Listing.countDocuments(addExactFilter(filter, 'qcStatus', listingQcStatuses.DRAFT)),
    Listing.countDocuments(addExactFilter(filter, 'qcStatus', listingQcStatuses.APPROVED)),
    Listing.countDocuments(addExactFilter(filter, 'qcStatus', listingQcStatuses.REJECTED)),
  ]);

  return {
    totalListingCount,
    amazonListingCount,
    etsyListingCount,
    noPsdCount,
    draftCount,
    approvedCount,
    rejectedCount,
  };
}

async function update(listingId, patch) {
  return withProductTypeGroup(Listing.findByIdAndUpdate(
    listingId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  )).lean();
}

module.exports = {
  create,
  findById,
  findByIds,
  findSummariesByIds,
  findByAsin,
  findBySku,
  list,
  summarize,
  update,
  buildFilter,
};
