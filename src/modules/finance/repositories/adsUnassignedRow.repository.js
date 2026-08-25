const AdsUnassignedRow = require('../models/adsUnassignedRow.model');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

function identity(payload) {
  return {
    sourceRef: payload.sourceRef,
    reportDate: payload.reportDate,
    advertiserAccountId: payload.advertiserAccountId,
    campaignId: payload.campaignId || null,
    portfolioId: payload.portfolioId || null,
  };
}

function upsertPending(payload) {
  return AdsUnassignedRow.findOneAndUpdate(identity(payload), {
    $set: { ...payload, status: 'PENDING', resolvedAt: null },
  }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }).lean();
}

function markResolved(payload) {
  return AdsUnassignedRow.findOneAndUpdate(identity(payload), {
    $set: { status: 'RESOLVED', resolvedAt: new Date() },
  }, { new: true }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 50, maxLimit: 100 });
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.advertiserAccountId) filter.advertiserAccountId = query.advertiserAccountId;
  const [items, total] = await Promise.all([
    AdsUnassignedRow.find(filter).sort({ status: 1, reportDate: -1, createdAt: -1 })
      .skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    AdsUnassignedRow.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

module.exports = { list, markResolved, upsertPending };
