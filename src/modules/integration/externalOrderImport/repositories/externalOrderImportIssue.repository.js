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

module.exports = {
  create,
  list,
  listByJob,
};
