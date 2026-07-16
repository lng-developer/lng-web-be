const FulfillmentPlan = require('../models/fulfillmentPlan.model');
const mongoose = require('mongoose');

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
    .select('orderId orderItemId status selectionMode snapshot blockingReasons checks resolvedAt createdAt updatedAt')
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

async function summarize(query = {}) {
  const filter = buildFilter(query);
  const [result = {}] = await FulfillmentPlan.aggregate([
    { $match: filter },
    {
      $facet: {
        total: [{ $count: 'count' }],
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        bySelectionMode: [{ $group: { _id: '$selectionMode', count: { $sum: 1 } } }],
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
  };
}

module.exports = {
  buildFilter,
  findActiveByOrderItem: findByOrderItem,
  findByOrderItem,
  listByOrderItemIds,
  summarize,
  upsertActiveByOrderItem: upsertByOrderItem,
  upsertByOrderItem,
};
