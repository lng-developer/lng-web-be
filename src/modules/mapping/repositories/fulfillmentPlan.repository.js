const FulfillmentPlan = require('../models/fulfillmentPlan.model');

async function findByOrderItem(orderItemId) {
  return FulfillmentPlan.findOne({ orderItemId }).lean();
}

async function findByOrderItems(orderItemIds = []) {
  if (!orderItemIds.length) return [];
  return FulfillmentPlan.find({ orderItemId: { $in: orderItemIds } }).lean();
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
  findByOrderItems,
  upsertActiveByOrderItem: upsertByOrderItem,
  upsertByOrderItem,
};
