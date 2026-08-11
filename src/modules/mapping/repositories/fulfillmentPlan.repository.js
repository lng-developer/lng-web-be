const FulfillmentPlan = require('../models/fulfillmentPlan.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  if (query.status) filter.status = query.status;
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = query.dateFrom;
    if (query.dateTo) filter.createdAt.$lte = query.dateTo;
  }
  return filter;
}

async function findByOrderItem(orderItemId) {
  return FulfillmentPlan.findOne({ orderItemId }).lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  if (!orderItemIds.length) return [];
  return FulfillmentPlan.find({ orderItemId: { $in: orderItemIds } })
    .select('orderId orderItemId listingVariantId status selectionMode snapshot blockingReasons checks resolvedAt createdAt updatedAt')
    .lean();
}

async function listBlockedByListingAndProductType(listingId, productTypeGroupId) {
  return FulfillmentPlan.find({ listingId, productTypeGroupId, status: 'BLOCKED' })
    .select('orderItemId')
    .lean();
}

async function listPsdRefreshTargetsByListingAndProductType(listingId, productTypeGroupId) {
  return FulfillmentPlan.find({
    listingId,
    productTypeGroupId,
    $or: [
      { status: 'BLOCKED' },
      { listingVariantId: null },
      { listingVariantId: { $exists: false } },
    ],
  })
    .select('orderItemId')
    .lean();
}

async function listBlockedOrderItemIdsForRuleScope(query = {}) {
  const limit = Math.min(Number(query.limit) || 50, 100);
  const filter = { ...buildFilter(query), status: 'BLOCKED' };
  if (query.productTypeGroupId) filter.productTypeGroupId = toObjectId(query.productTypeGroupId);
  if (query.configCode) {
    const escaped = escapeRegex(String(query.configCode).trim());
    filter['snapshot.orderItem.sku'] = new RegExp(`(^|-)${escaped}(-|$)`, 'i');
  }

  return FulfillmentPlan.find(filter)
    .sort({ updatedAt: 1, _id: 1 })
    .limit(limit)
    .select('orderItemId')
    .lean();
}

async function upsertByOrderItem(orderItemId, payload) {
  return FulfillmentPlan.findOneAndUpdate(
    { orderItemId },
    { $set: payload },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const liveOrderItemStages = Object.freeze([
  { $lookup: { from: 'orderitems', localField: 'orderItemId', foreignField: '_id', as: '_orderItem' } },
  { $match: { '_orderItem.0': { $exists: true } } },
  { $unset: '_orderItem' },
]);

async function listUnmatched(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = { ...buildFilter(query), status: 'BLOCKED' };
  if (query.blocker) filter.blockingReasons = query.blocker;
  if (query.blockers?.length) filter.blockingReasons = { $in: query.blockers };
  if (query.age) {
    const ageMs = query.age === 'OVER_3_DAYS' ? 3 * 86400000 : 86400000;
    filter.updatedAt = query.age === 'TODAY'
      ? { $gte: new Date(Date.now() - ageMs) }
      : { $lte: new Date(Date.now() - ageMs) };
  }
  if (query.q) {
    const pattern = new RegExp(escapeRegex(String(query.q).trim()), 'i');
    filter.$or = [
      { 'snapshot.orderItem.externalOrderId': pattern },
      { 'snapshot.orderItem.id': pattern },
      { 'snapshot.orderItem.sku': pattern },
      { 'snapshot.orderItem.title': pattern },
    ];
  }

  const [result = {}] = await FulfillmentPlan.aggregate([
    { $match: filter },
    ...liveOrderItemStages,
    { $sort: { updatedAt: -1, _id: -1 } },
    {
      $facet: {
        items: [{ $skip: getPaginationOffset({ page, limit }) }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  return {
    items: result.items || [],
    pagination: { total: result.total?.[0]?.count || 0, page, limit },
  };
}

async function summarize(query = {}) {
  const filter = buildFilter(query);
  const [result = {}] = await FulfillmentPlan.aggregate([
    { $match: filter },
    ...liveOrderItemStages,
    {
      $facet: {
        total: [{ $count: 'count' }],
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        bySelectionMode: [{ $group: { _id: '$selectionMode', count: { $sum: 1 } } }],
        byBlockingReason: [
          { $unwind: '$blockingReasons' },
          { $group: { _id: '$blockingReasons', count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const mapRows = (rows = []) => Object.fromEntries(
    rows.filter((row) => row._id !== null && row._id !== undefined).map((row) => [row._id, row.count || 0]),
  );

  return {
    total: result.total?.[0]?.count || 0,
    byStatus: mapRows(result.byStatus),
    bySelectionMode: mapRows(result.bySelectionMode),
    byBlockingReason: mapRows(result.byBlockingReason),
  };
}

module.exports = {
  buildFilter,
  findActiveByOrderItem: findByOrderItem,
  findByOrderItem,
  listByOrderItemIds,
  listBlockedByListingAndProductType,
  listPsdRefreshTargetsByListingAndProductType,
  listBlockedOrderItemIdsForRuleScope,
  listUnmatched,
  summarize,
  upsertActiveByOrderItem: upsertByOrderItem,
  upsertByOrderItem,
};
