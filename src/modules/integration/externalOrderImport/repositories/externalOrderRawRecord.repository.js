const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExternalOrderRawRecord = require('../models/externalOrderRawRecord.model');

function buildFilter({ importJobId, externalOrderId, importStatus, normalizeStatus } = {}) {
  const filter = {};
  if (importJobId) filter.importJobId = importJobId;
  if (externalOrderId) filter.externalOrderId = externalOrderId;
  if (importStatus) filter.importStatus = importStatus;
  if (normalizeStatus) filter.normalizeStatus = normalizeStatus;
  return filter;
}

async function create(payload) {
  const document = await ExternalOrderRawRecord.create(payload);
  return document.toObject();
}

async function findById(rawRecordId) {
  return ExternalOrderRawRecord.findById(rawRecordId).lean();
}

async function findByJobAndRow(importJobId, rowNumber) {
  return ExternalOrderRawRecord.findOne({ importJobId, rowNumber }).lean();
}

async function updateNormalizeResult(rawRecordId, patch) {
  return ExternalOrderRawRecord.findByIdAndUpdate(
    rawRecordId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateImportResult(rawRecordId, patch) {
  return ExternalOrderRawRecord.findByIdAndUpdate(
    rawRecordId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function listByJob(importJobId, { page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter({ ...filters, importJobId });
  const [items, total] = await Promise.all([
    ExternalOrderRawRecord.find(filter)
      .sort({ rowNumber: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ExternalOrderRawRecord.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listByExternalOrderId(externalOrderId) {
  return ExternalOrderRawRecord.find({ externalOrderId })
    .sort({ rowNumber: 1, _id: 1 })
    .lean();
}

module.exports = {
  create,
  findById,
  findByJobAndRow,
  updateNormalizeResult,
  updateImportResult,
  listByJob,
  listByExternalOrderId,
};
