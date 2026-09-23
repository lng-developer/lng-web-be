const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const Listing = require('../models/listing.model');
const {
  listingQcStatuses,
  recordStatuses,
  salesChannelCodes,
} = require('../constants/catalog.constants');

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
  psdState,
  listingIds,
} = {}) {
  const filter = {};
  if (listingIds) {
    if (!listingIds.length) return { _id: { $in: [] } };
    filter._id = { $in: listingIds };
  }
  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length > 0) filter.shopId = { $in: shopIds };
  if (salesChannelCode) filter.salesChannelCode = salesChannelCode;
  if (marketplaceCode) filter.marketplaceCode = marketplaceCode;
  if (status) filter.status = status;
  if (qcStatus) filter.qcStatus = qcStatus;
  if (psdState === 'missing') filter.defaultPsdTemplateAssetId = null;
  if (psdState === 'ready') filter.defaultPsdTemplateAssetId = { $ne: null };

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
  return Listing.findById(listing._id).lean();
}

async function findById(listingId) {
  return Listing.findById(listingId).lean();
}

async function findByIds(listingIds = []) {
  if (!listingIds.length) return [];
  return Listing.find({ _id: { $in: listingIds } }).lean();
}

async function findByAsins(asins = []) {
  if (!asins.length) return [];
  return Listing.find({ asin: { $in: asins } }).lean();
}

async function findSummariesByIds(listingIds = []) {
  if (!listingIds.length) return [];
  return Listing.find({ _id: { $in: listingIds } })
    .select('sku asin etsyListingId title productImageUrl defaultPsdTemplateAssetId')
    .lean();
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

  return Listing.findOne(filter).lean();
}

async function findByAsin({ salesChannelCode, marketplaceCode, asin, includeInactive = false } = {}) {
  const filter = {
    salesChannelCode,
    marketplaceCode,
    asin,
  };

  if (!includeInactive) {
    filter.status = recordStatuses.ACTIVE;
    filter.qcStatus = listingQcStatuses.APPROVED;
  }

  return Listing.findOne(filter).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    Listing.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Listing.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listAll(filters = {}) {
  return Listing.find(buildFilter(filters))
    .sort({ createdAt: -1, _id: -1 })
    .lean();
}

async function summarize(filters = {}) {
  const filter = buildFilter(filters);
  const [result = {}] = await Listing.aggregate([
    { $match: filter },
    { $facet: {
      totals: [{ $group: {
        _id: null,
        totalListingCount: { $sum: 1 },
        amazonListingCount: { $sum: { $cond: [{ $eq: ['$salesChannelCode', salesChannelCodes.AMAZON] }, 1, 0] } },
        etsyListingCount: { $sum: { $cond: [{ $eq: ['$salesChannelCode', salesChannelCodes.ETSY] }, 1, 0] } },
        draftCount: { $sum: { $cond: [{ $eq: ['$qcStatus', listingQcStatuses.DRAFT] }, 1, 0] } },
        approvedCount: { $sum: { $cond: [{ $eq: ['$qcStatus', listingQcStatuses.APPROVED] }, 1, 0] } },
        rejectedCount: { $sum: { $cond: [{ $eq: ['$qcStatus', listingQcStatuses.REJECTED] }, 1, 0] } },
        noPsdCount: { $sum: { $cond: [{ $eq: ['$defaultPsdTemplateAssetId', null] }, 1, 0] } },
      } }],
      channelCounts: [
        { $group: { _id: '$salesChannelCode', count: { $sum: 1 } } },
        { $project: { _id: 0, code: '$_id', count: 1 } },
        { $sort: { code: 1 } },
      ],
    } },
  ]);
  const totals = result.totals?.[0] || {};

  return {
    totalListingCount: totals.totalListingCount || 0,
    amazonListingCount: totals.amazonListingCount || 0,
    etsyListingCount: totals.etsyListingCount || 0,
    draftCount: totals.draftCount || 0,
    approvedCount: totals.approvedCount || 0,
    rejectedCount: totals.rejectedCount || 0,
    noPsdCount: totals.noPsdCount || 0,
    channelCounts: result.channelCounts || [],
  };
}

async function update(listingId, patch) {
  return Listing.findByIdAndUpdate(
    listingId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

function findImageSyncCandidates({ shopId, now = new Date(), manual = false, asins, offset = 0 }) {
  const cutoff = new Date(now.getTime() - 7 * 86400000);
  return Listing.find({
    shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', asin: /^[A-Z0-9]{10}$/,
    ...(asins !== undefined ? { asin: { $in: asins } } : {}),
    'imageSync.source': { $ne: 'MANUAL' },
    $and: [{ $or: [
      { 'imageSync.source': { $in: ['IMPORTED', 'AMAZON_SYNC'] } },
      { productImageUrl: null }, { productImageUrl: '' },
      { productImageUrl: /^https:\/\/(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images\.amazon\.com)\/images\/I\// },
      { productImageUrl: /^https:\/\/m\.media-amazon\.com\/images\/S\/gestalt-seller-images-prod-us-east-1\// },
    ] }],
    ...(manual ? {} : { createdAt: { $lte: cutoff }, $or: [{ 'imageSync.lastCheckedAt': null }, { 'imageSync.lastCheckedAt': { $lte: cutoff } }] }),
  }).sort({ createdAt: 1, _id: 1 }).skip(offset).limit(10001).lean();
}
function compareAndSetImage(listing, patch) {
  return Listing.findOneAndUpdate({
    _id: listing._id, shopId: listing.shopId, asin: listing.asin,
    productImageUrl: listing.productImageUrl ?? null,
    updatedAt: listing.updatedAt,
    'imageSync.source': { $ne: 'MANUAL' },
  }, { $set: patch }, { returnDocument: 'after', runValidators: true }).lean();
}

module.exports = {
  findImageSyncCandidates,
  compareAndSetImage,
  create,
  findById,
  findByIds,
  findSummariesByIds,
  findByAsin,
  findByAsins,
  findBySku,
  list,
  listAll,
  summarize,
  update,
  buildFilter,
};
