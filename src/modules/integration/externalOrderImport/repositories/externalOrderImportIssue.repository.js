const mongoose = require('mongoose');
const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExternalOrderImportIssue = require('../models/externalOrderImportIssue.model');
function buildFilter({
  importJobId,
  importJobIds,
  source,
  status,
  issueType,
  severity,
  externalOrderId,
  externalItemId,
} = {}) {
  const filter = {};
  if (importJobId) filter.importJobId = importJobId;
  else if (importJobIds) filter.importJobId = { $in: importJobIds };
  if (source) filter.source = source;
  if (status) filter.status = status;
  if (issueType) filter.issueType = issueType;
  if (severity) filter.severity = severity;
  if (externalOrderId) filter.externalOrderId = externalOrderId;
  if (externalItemId) filter.externalItemId = externalItemId;
  return filter;
}

async function create(payload) {
  const document = await ExternalOrderImportIssue.create(payload);
  return document.toObject();
}

async function findById(issueId) {
  return ExternalOrderImportIssue.findById(issueId).lean();
}

async function transitionOpen(issueId, patch) {
  return ExternalOrderImportIssue.findOneAndUpdate(
    { _id: issueId, status: 'OPEN' },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    ExternalOrderImportIssue.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ExternalOrderImportIssue.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

function listByJob(importJobId, params = {}) {
  return list({ ...params, importJobId });
}

async function countByJobStatus(importJobId) {
  const jobObjectId = mongoose.Types.ObjectId.isValid(importJobId)
    ? new mongoose.Types.ObjectId(importJobId)
    : importJobId;
  const rows = await ExternalOrderImportIssue.aggregate([
    { $match: { importJobId: jobObjectId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  return rows.reduce((acc, row) => {
    acc[row._id] = row.count;
    acc.total += row.count;
    return acc;
  }, { total: 0 });
}

module.exports = {
  async summarizeOpenIssues(jobIds) {
    return ExternalOrderImportIssue.aggregate([
      { $match: { importJobId: { $in: jobIds.map(id => new mongoose.Types.ObjectId(id)) }, status: 'OPEN' } },
      { $group: { _id: '$importJobId', openIssues: { $sum: 1 },
        addressIssues: { $sum: { $cond: [{ $eq: ['$issueType', 'ADDRESS_VALIDATION_FAILED'] }, 1, 0] } },
      } },
    ]);
  },
  countByJobStatus,
  create,
  findById,
  list,
  listByJob,
  transitionOpen,
};
