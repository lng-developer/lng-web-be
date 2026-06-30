const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const OrderTimeline = require('../models/orderTimeline.model');

async function create(payload) {
  const timeline = await OrderTimeline.create(payload);
  return timeline.toObject();
}

async function listByOrder(orderId, { page = 1, limit = 20 } = {}) {
  const filter = { orderId };
  const [items, total] = await Promise.all([
    OrderTimeline.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderTimeline.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listByOrderItem(orderItemId, { page = 1, limit = 20 } = {}) {
  const filter = { orderItemId };
  const [items, total] = await Promise.all([
    OrderTimeline.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderTimeline.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listByShop(shopId, { page = 1, limit = 20 } = {}) {
  const filter = { shopId };
  const [items, total] = await Promise.all([
    OrderTimeline.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderTimeline.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

module.exports = {
  create,
  listByOrder,
  listByOrderItem,
  listByShop,
};
