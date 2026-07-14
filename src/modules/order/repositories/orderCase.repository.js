const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const OrderCase = require('../models/orderCase.model');

function toRegex(value) {
  if (!value) return null;
  return { $regex: String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
}

function buildFilter({
  orderId,
  orderItemId,
  shopId,
  shopIds,
  status,
  caseType,
  severity,
  q,
} = {}) {
  const filter = {};
  if (orderId) filter.orderId = orderId;
  if (orderItemId) filter.orderItemId = orderItemId;
  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length) filter.shopId = { $in: shopIds };
  if (status) filter.status = status;
  if (caseType) filter.caseType = caseType;
  if (severity) filter.severity = severity;
  const qRegex = toRegex(q);
  if (qRegex) filter.$or = [{ title: qRegex }, { description: qRegex }, { caseType: qRegex }];
  return filter;
}

async function create(payload) {
  const doc = await OrderCase.create(payload);
  return doc.toObject();
}

async function findById(caseId) {
  return OrderCase.findById(caseId).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    OrderCase.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderCase.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function update(caseId, patch) {
  return OrderCase.findByIdAndUpdate(
    caseId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function addComment(caseId, comment) {
  return OrderCase.findByIdAndUpdate(
    caseId,
    { $push: { comments: comment } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function countOpenByOrder(orderId) {
  return OrderCase.countDocuments({ orderId, status: 'OPEN' });
}

module.exports = {
  create,
  findById,
  list,
  update,
  addComment,
  countOpenByOrder,
  buildFilter,
};
