const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExternalOrderImportJob = require('../models/externalOrderImportJob.model');
const {
  externalOrderImportJobStatuses,
} = require('../constants/externalOrderImportStatuses');

function buildFilter({ source, sourceType, shopId, shopIds, status, dateFrom, dateTo } = {}) {
  const filter = {};
  if (source) filter.source = source;
  if (sourceType) filter.sourceType = sourceType;
  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length > 0) filter.shopId = { $in: shopIds };
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.createdAt = {
      ...(dateFrom && { $gte: new Date(dateFrom) }),
      ...(dateTo && { $lte: new Date(dateTo) }),
    };
  }
  return filter;
}

async function create(payload) {
  const document = await ExternalOrderImportJob.create(payload);
  return document.toObject();
}

async function findById(jobId) {
  return ExternalOrderImportJob.findById(jobId).lean();
}

async function findIds(filters = {}) {
  return ExternalOrderImportJob.distinct('_id', buildFilter(filters));
}

async function findShopIdsByIds(jobIds = []) {
  if (jobIds.length === 0) return [];
  return ExternalOrderImportJob.find({ _id: { $in: jobIds } })
    .select({ _id: 1, shopId: 1 })
    .lean();
}

async function updateStatus(jobId, status, patch = {}) {
  return ExternalOrderImportJob.findByIdAndUpdate(
    jobId,
    { $set: { status, ...patch } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateCounters(jobId, countersPatch) {
  return ExternalOrderImportJob.findByIdAndUpdate(
    jobId,
    { $set: countersPatch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    ExternalOrderImportJob.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ExternalOrderImportJob.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listStaleActive({ cutoff, limit = 50 } = {}) {
  return ExternalOrderImportJob.find({
    status: {
      $in: [
        externalOrderImportJobStatuses.PARSING,
        externalOrderImportJobStatuses.IMPORTING,
      ],
    },
    updatedAt: { $lte: cutoff },
  })
    .sort({ updatedAt: 1, _id: 1 })
    .limit(limit)
    .lean();
}

module.exports = {
  create,
  findById,
  findIds,
  findShopIdsByIds,
  updateStatus,
  updateCounters,
  list,
  listStaleActive,
};
