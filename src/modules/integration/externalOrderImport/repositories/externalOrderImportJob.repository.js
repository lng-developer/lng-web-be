const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExternalOrderImportJob = require('../models/externalOrderImportJob.model');

function buildFilter({ source, sourceType, shopId, status } = {}) {
  const filter = {};
  if (source) filter.source = source;
  if (sourceType) filter.sourceType = sourceType;
  if (shopId) filter.shopId = shopId;
  if (status) filter.status = status;
  return filter;
}

async function create(payload) {
  const document = await ExternalOrderImportJob.create(payload);
  return document.toObject();
}

async function findById(jobId) {
  return ExternalOrderImportJob.findById(jobId).lean();
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

module.exports = {
  create,
  findById,
  updateStatus,
  updateCounters,
  list,
};
