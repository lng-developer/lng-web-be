const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const OrderItem = require('../models/orderItem.model');

function buildFilter({
  orderId,
  shopId,
  status,
  salesChannelCode,
  marketplaceCode,
  externalOrderId,
} = {}) {
  const filter = {};

  if (orderId) filter.orderId = orderId;
  if (shopId) filter.shopId = shopId;
  if (status) filter.status = status;
  if (salesChannelCode) filter.salesChannelCode = salesChannelCode;
  if (marketplaceCode) filter.marketplaceCode = marketplaceCode;
  if (externalOrderId) filter.externalOrderId = externalOrderId;

  return filter;
}

async function create(payload) {
  const orderItem = await OrderItem.create(payload);
  return orderItem.toObject();
}

async function findById(orderItemId) {
  return OrderItem.findById(orderItemId).lean();
}

async function findByExternalIdentity({ orderId, externalItemId }) {
  return OrderItem.findOne({ orderId, externalItemId }).lean();
}

function buildAtomicUpdate({ set = {}, addToSet = {} } = {}) {
  const update = {};

  if (Object.keys(set).length > 0) {
    update.$set = set;
  }

  Object.entries(addToSet).forEach(([field, values]) => {
    if (!Array.isArray(values) || values.length === 0) {
      return;
    }

    update.$addToSet = update.$addToSet || {};
    update.$addToSet[field] = { $each: values };
  });

  return update;
}

async function updateFromExternalImport(orderItemId, payload) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    buildAtomicUpdate(payload),
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateStatus(orderItemId, status) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { status } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateExternalItemId(orderItemId, externalItemId) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { externalItemId } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateAsin(orderItemId, asin) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { asin } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function listByOrder(orderId, { page = 1, limit = 20, status } = {}) {
  const filter = { orderId };

  if (status) {
    filter.status = status;
  }

  const [items, total] = await Promise.all([
    OrderItem.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderItem.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listByOrderIds(orderIds = [], { limitPerOrder = 100 } = {}) {
  if (!orderIds.length) return [];

  const items = await OrderItem.find({ orderId: { $in: orderIds } })
    .sort({ orderId: 1, createdAt: 1, _id: 1 })
    .lean();

  const counts = new Map();
  return items.filter((item) => {
    const orderId = String(item.orderId);
    const count = counts.get(orderId) || 0;
    if (count >= limitPerOrder) return false;
    counts.set(orderId, count + 1);
    return true;
  });
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    OrderItem.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderItem.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

module.exports = {
  create,
  findById,
  findByExternalIdentity,
  updateFromExternalImport,
  updateStatus,
  updateExternalItemId,
  updateAsin,
  listByOrder,
  listByOrderIds,
  list,
};
