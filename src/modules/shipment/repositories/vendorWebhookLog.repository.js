const VendorWebhookLog = require('../models/vendorWebhookLog.model');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const mongoose = require('mongoose');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.provider) filter.provider = String(query.provider).trim().toUpperCase();
  if (query.outcome) filter.outcome = String(query.outcome).trim().toUpperCase();
  if (query.vendorSubmissionId) filter.vendorSubmissionId = query.vendorSubmissionId;
  if (query.orderItemId) filter.orderItemId = query.orderItemId;
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      filter.createdAt.$lte = new Date(
        typeof query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)
          ? `${query.dateTo}T23:59:59.999Z`
          : query.dateTo,
      );
    }
  }
  return filter;
}

async function create(payload) {
  const log = await VendorWebhookLog.create(payload);
  return log.toObject();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    VendorWebhookLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    VendorWebhookLog.countDocuments(filter),
  ]);
  return toPaginatedResult({
    items, total, page, limit,
  });
}

module.exports = {
  buildFilter,
  create,
  list,
};
