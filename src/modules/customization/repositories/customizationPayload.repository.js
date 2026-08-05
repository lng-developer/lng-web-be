const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const CustomizationPayload = require('../models/customizationPayload.model');
const mongoose = require('mongoose');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

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

async function findLatestByOrderItems(orderItemIds = []) {
  if (!orderItemIds.length) return [];
  const payloads = await CustomizationPayload.find({ orderItemId: { $in: orderItemIds } })
    .select('orderItemId shopId status errorCode errorMessage parsedData assets createdAt')
    .sort({ orderItemId: 1, createdAt: -1, _id: -1 })
    .lean();
  const seen = new Set();
  return payloads.filter((payload) => {
    const orderItemId = String(payload.orderItemId);
    if (seen.has(orderItemId)) return false;
    seen.add(orderItemId);
    return true;
  });
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

function operationalMatch({ shopId, shopIds, orderItemIds, source, errorCode, dateFrom, dateTo } = {}) {
  const match = {};
  if (shopId) match.shopId = toObjectId(shopId);
  if (shopIds?.length) match.shopId = { $in: shopIds.map(toObjectId) };
  if (orderItemIds) match.orderItemId = { $in: orderItemIds.map(toObjectId) };
  if (source) match.source = source;
  if (errorCode) match.errorCode = errorCode;
  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) match.createdAt.$lte = new Date(dateTo);
  }
  return match;
}

function latestStages(query = {}) {
  const defaultStatuses = ['PENDING', 'NEEDS_REVIEW', 'FAILED'];
  const statuses = query.status ? (Array.isArray(query.status) ? query.status : [query.status]) : defaultStatuses;
  return [
    { $match: operationalMatch(query) },
    { $sort: { orderItemId: 1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$orderItemId', payload: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$payload' } },
    ...((query.blockedOnly !== false || query.status) ? [{ $match: { status: { $in: statuses } } }] : []),
  ];
}

async function listOperational({ page = 1, limit = 20, ...query } = {}) {
  const [result = {}] = await CustomizationPayload.aggregate([
    ...latestStages(query),
    { $sort: { createdAt: 1, _id: 1 } },
    { $facet: {
      items: [{ $skip: getPaginationOffset({ page, limit }) }, { $limit: limit }],
      total: [{ $count: 'count' }],
    } },
  ]);
  return toPaginatedResult({ items: result.items || [], total: result.total?.[0]?.count || 0, page, limit });
}

async function summarizeOperational(query = {}) {
  const [summary] = await CustomizationPayload.aggregate([
    ...latestStages({ ...query, blockedOnly: false, status: undefined }),
    { $group: {
      _id: null,
      pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
      needsReview: { $sum: { $cond: [{ $eq: ['$status', 'NEEDS_REVIEW'] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
      oldestBlockedAt: { $min: { $cond: [{ $in: ['$status', ['PENDING', 'NEEDS_REVIEW', 'FAILED']] }, '$createdAt', null] } },
    } },
    { $project: { _id: 0 } },
  ]);
  return summary || { pending: 0, needsReview: 0, failed: 0, oldestBlockedAt: null };
}

module.exports = {
  create,
  findById,
  findByOrderItem,
  findLatestByOrderItems,
  findByOrderItemAndHash,
  updateStatus,
  updateParsedData,
  updateAssets,
  incrementRetry,
  list,
  listOperational,
  summarizeOperational,
};
