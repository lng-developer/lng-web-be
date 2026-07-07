const VendorSubmission = require('../models/vendorSubmission.model');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const { vendorSubmissionStatuses } = require('../constants/vendorSubmission.constants');

function buildFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.productionTaskId) filter.productionTaskId = query.productionTaskId;
  if (query.orderId) filter.orderId = query.orderId;
  if (query.orderItemId) filter.orderItemId = query.orderItemId;
  if (query.shopId) filter.shopId = query.shopId;
  return filter;
}

async function create(payload) {
  const submission = await VendorSubmission.create(payload);
  return submission.toObject();
}

async function findById(submissionId) {
  return VendorSubmission.findById(submissionId).lean();
}

async function findActiveByProductionTask(productionTaskId) {
  return VendorSubmission.findOne({
    productionTaskId,
    status: { $ne: vendorSubmissionStatuses.CANCELLED },
  }).lean();
}

async function findByProductionTaskId(productionTaskId) {
  return VendorSubmission.findOne({ productionTaskId }).sort({ updatedAt: -1 }).lean();
}

async function findByOrderItemId(orderItemId) {
  return VendorSubmission.findOne({ orderItemId }).sort({ updatedAt: -1 }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    VendorSubmission.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    VendorSubmission.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function updateById(submissionId, patch) {
  return VendorSubmission.findByIdAndUpdate(
    submissionId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  buildFilter,
  create,
  findActiveByProductionTask,
  findById,
  findByOrderItemId,
  findByProductionTaskId,
  list,
  updateById,
};
