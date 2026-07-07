const FinanceSnapshot = require('../models/financeSnapshot.model');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

function buildFilter(query = {}) {
  const filter = {};
  if (query.orderId) filter.orderId = query.orderId;
  if (query.orderItemId) filter.orderItemId = query.orderItemId;
  if (query.shopId) filter.shopId = query.shopId;
  if (query.snapshotStatus) filter.snapshotStatus = query.snapshotStatus;
  if (query.costStatus) filter.costStatus = query.costStatus;
  return filter;
}

async function findByOrderItem(orderItemId) {
  return FinanceSnapshot.findOne({ orderItemId }).lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  return FinanceSnapshot.find({ orderItemId: { $in: orderItemIds } }).lean();
}

async function listByOrder(orderId) {
  return FinanceSnapshot.find({ orderId }).sort({ calculatedAt: -1, _id: -1 }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    FinanceSnapshot.find(filter)
      .sort({ calculatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    FinanceSnapshot.countDocuments(filter),
  ]);
  return toPaginatedResult({
    items, total, page, limit,
  });
}

async function upsertByOrderItem(orderItemId, payload) {
  return FinanceSnapshot.findOneAndUpdate(
    { orderItemId },
    { $set: payload },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  ).lean();
}

module.exports = {
  buildFilter,
  findByOrderItem,
  list,
  listByOrder,
  listByOrderItemIds,
  upsertByOrderItem,
};
