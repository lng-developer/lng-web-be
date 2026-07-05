const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const CustomizationPayload = require('../models/customizationPayload.model');

function buildFilter({ shopId, shopIds, orderItemId, status } = {}) {
  const filter = {};

  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length) filter.shopId = { $in: shopIds };
  if (orderItemId) filter.orderItemId = orderItemId;
  if (status) filter.status = status;

  return filter;
}

async function create(payload) {
  const document = await CustomizationPayload.create(payload);
  return document.toObject();
}

async function findById(payloadId) {
  return CustomizationPayload.findById(payloadId).lean();
}

async function findByOrderItem(orderItemId) {
  return CustomizationPayload.findOne({ orderItemId })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  return CustomizationPayload.find({ orderItemId: { $in: orderItemIds } })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
}

async function findByOrderItemAndHash(orderItemId, rawCustomizationHash) {
  return CustomizationPayload.findOne({ orderItemId, rawCustomizationHash })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
}

async function updateStatus(payloadId, status, patch = {}) {
  return CustomizationPayload.findByIdAndUpdate(
    payloadId,
    { $set: { status, ...patch } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateParsedData(payloadId, parsedData, patch = {}) {
  return CustomizationPayload.findByIdAndUpdate(
    payloadId,
    { $set: { parsedData, ...patch } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateAssets(payloadId, assets) {
  return CustomizationPayload.findByIdAndUpdate(
    payloadId,
    { $set: { assets } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function incrementRetry(payloadId, patch = {}) {
  return CustomizationPayload.findByIdAndUpdate(
    payloadId,
    { $inc: { retryCount: 1 }, $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    CustomizationPayload.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    CustomizationPayload.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

module.exports = {
  create,
  findById,
  findByOrderItem,
  listByOrderItemIds,
  findByOrderItemAndHash,
  updateStatus,
  updateParsedData,
  updateAssets,
  incrementRetry,
  list,
};
