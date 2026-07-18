const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExternalOrderRawRecord = require('../models/externalOrderRawRecord.model');

function buildFilter({ importJobId, externalOrderId, importStatus, normalizeStatus, postImportStatus } = {}) {
  const filter = {};
  if (importJobId) filter.importJobId = importJobId;
  if (externalOrderId) filter.externalOrderId = externalOrderId;
  if (importStatus) filter.importStatus = importStatus;
  if (normalizeStatus) filter.normalizeStatus = normalizeStatus;
  if (postImportStatus) filter.postImportStatus = postImportStatus;
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

async function updatePostImportResult(rawRecordId, patch, { incrementAttempts = false } = {}) {
  const update = { $set: patch };
  if (incrementAttempts) update.$inc = { postImportAttempts: 1 };
  return ExternalOrderRawRecord.findByIdAndUpdate(
    rawRecordId,
    update,
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function claimPostImportRecords(rawRecordIds = [], leaseToken, { now = new Date(), leaseMs = 5 * 60 * 1000 } = {}) {
  const ids = [...new Set(rawRecordIds.filter(Boolean).map(String))];
  if (!ids.length) return false;

  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const filter = {
    _id: { $in: ids },
    $and: [
      {
        $or: [
          { postImportStatus: { $in: ['QUEUED', 'FAILED'] } },
          { postImportStatus: 'PROCESSING', postImportLeaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { postImportLeaseExpiresAt: null },
          { postImportLeaseExpiresAt: { $lte: now } },
        ],
      },
    ],
  };
  const update = {
    $set: {
      postImportStatus: 'PROCESSING',
      postImportStartedAt: now,
      postImportFinishedAt: null,
      postImportErrorCode: null,
      postImportErrorMessage: null,
      postImportLeaseToken: leaseToken,
      postImportLeaseExpiresAt: leaseExpiresAt,
    },
    $inc: { postImportAttempts: 1 },
  };
  const result = await ExternalOrderRawRecord.updateMany(filter, update);
  return result.modifiedCount === ids.length;
}

async function updatePostImportResultForLease(rawRecordId, leaseToken, patch) {
  return ExternalOrderRawRecord.findOneAndUpdate(
    { _id: rawRecordId, postImportLeaseToken: leaseToken },
    {
      $set: {
        ...patch,
        postImportLeaseToken: null,
        postImportLeaseExpiresAt: null,
      },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function listStalePostImportRecords({ cutoff, limit = 50 } = {}) {
  return ExternalOrderRawRecord.find({
    importStatus: 'IMPORTED',
    $or: [
      { postImportStatus: 'QUEUED', postImportQueuedAt: { $lte: cutoff } },
      { postImportStatus: 'PROCESSING', postImportLeaseExpiresAt: { $lte: cutoff } },
    ],
  })
    .sort({ postImportQueuedAt: 1, postImportStartedAt: 1, _id: 1 })
    .limit(limit)
    .lean();
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

async function listAllByJob(importJobId, filters = {}) {
  return ExternalOrderRawRecord.find(buildFilter({ ...filters, importJobId }))
    .sort({ rowNumber: 1, _id: 1 })
    .lean();
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
  updatePostImportResult,
  claimPostImportRecords,
  updatePostImportResultForLease,
  listStalePostImportRecords,
  listAllByJob,
  listByJob,
  listByExternalOrderId,
};
