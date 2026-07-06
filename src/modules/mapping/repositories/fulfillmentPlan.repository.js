const FulfillmentPlan = require('../models/fulfillmentPlan.model');

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

module.exports = {
  findActiveByOrderItem: findByOrderItem,
  findByOrderItem,
  listByOrderItemIds,
  upsertActiveByOrderItem: upsertByOrderItem,
  upsertByOrderItem,
};
