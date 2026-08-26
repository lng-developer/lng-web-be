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

async function create(payload, { session } = {}) {
  if (!session) {
    const doc = await OrderCase.create(payload);
    return doc.toObject();
  }
  const [doc] = await OrderCase.create([payload], { session });
  return doc.toObject();
}

async function findById(caseId) {
  return OrderCase.findById(caseId).lean();
}

async function findOpenByOrderAndType(orderId, caseType) {
  return OrderCase.findOne({ orderId, caseType, status: 'OPEN' }).lean();
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

async function update(caseId, patch, { session, expectedStatus } = {}) {
  return OrderCase.findOneAndUpdate(
    { _id: caseId, ...(expectedStatus ? { status: expectedStatus } : {}) },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function addComment(caseId, comment, { session } = {}) {
  return OrderCase.findByIdAndUpdate(
    caseId,
    { $push: { comments: comment } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function countOpenByOrder(orderId, { session } = {}) {
  return OrderCase.countDocuments({ orderId, status: 'OPEN' }).session(session || null);
}

async function listLatestOpenByOrderIds(orderIds = []) {
  if (!orderIds.length) return [];
  return OrderCase.aggregate([
    { $match: { orderId: { $in: orderIds }, status: 'OPEN' } },
    { $sort: { orderId: 1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$orderId', case: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$case' } },
  ]);
}

module.exports = {
  create,
  findById,
  findOpenByOrderAndType,
  list,
  update,
  addComment,
  countOpenByOrder,
  listLatestOpenByOrderIds,
  buildFilter,
};
