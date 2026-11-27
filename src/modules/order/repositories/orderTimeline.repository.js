const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const OrderTimeline = require('../models/orderTimeline.model');

async function create(payload, { session } = {}) {
  if (session) {
    const [timeline] = await OrderTimeline.create([payload], { session });
    return timeline.toObject();
  }
  const timeline = await OrderTimeline.create(payload);
  return timeline.toObject();
}

async function createOnce(payload, { session } = {}) {
  return OrderTimeline.findOneAndUpdate(
    { idempotencyKey: payload.idempotencyKey },
    { $setOnInsert: payload },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true, session },
  ).lean();
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

async function listQuantityUpdates(orderItemIds, { session } = {}) {
  const query = OrderTimeline.find({ orderItemId: { $in: orderItemIds }, eventType: 'ORDER_ITEM_QUANTITY_UPDATED' })
    .select('orderItemId metadata.previousQuantity').sort({ createdAt: 1, _id: 1 });
  if (session) query.session(session);
  return query.lean();
}

module.exports = {
  listQuantityUpdates,
  create,
  createOnce,
  listByOrder,
  listByOrderItem,
  listByShop,
};
