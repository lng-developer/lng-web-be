const AdsSpendDaily = require('../models/adsSpendDaily.model');
const FinanceImportBatch = require('../models/financeImportBatch.model');
const mongoose = require('mongoose');
const MarketplaceFeeLine = require('../models/marketplaceFeeLine.model');
const MarketplaceSettlement = require('../models/marketplaceSettlement.model');
const MarketplaceSettlementLedgerLine = require('../models/marketplaceSettlementLedgerLine.model');
const RefundRecord = require('../models/refundRecord.model');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

const importedDataSources = Object.freeze({
  ads: { dateField: 'reportDate', model: AdsSpendDaily },
  settlements: { dateField: 'depositAt', model: MarketplaceSettlement },
  transactions: { dateField: 'postedAt', model: MarketplaceSettlementLedgerLine },
});

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function cleanNulls(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function upsert(model, filter, payload) {
  const { importBatchId, ...updates } = payload;
  const update = { $set: cleanNulls(updates) };
  if (importBatchId !== undefined) update.$setOnInsert = { importBatchId };

  return model.findOneAndUpdate(
    filter,
    update,
    {
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  ).lean();
}

async function createImportBatch(payload) {
  return FinanceImportBatch.create(payload);
}

async function findImportBatchById(batchId) {
  return FinanceImportBatch.findById(batchId).lean();
}

function buildScopeFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (Array.isArray(query.shopIds)) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  return filter;
}

function withDateRange(filter, dateField, query = {}) {
  if (!query.dateFrom && !query.dateTo) return filter;
  filter[dateField] = {};
  if (query.dateFrom) filter[dateField].$gte = query.dateFrom;
  if (query.dateTo) filter[dateField].$lte = query.dateTo;
  return filter;
}

async function listImportBatches(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildScopeFilter(query);
  if (query.sourceType) filter.sourceType = query.sourceType;
  if (query.status) filter.status = query.status;
  withDateRange(filter, 'createdAt', query);
  const [items, total] = await Promise.all([
    FinanceImportBatch.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    FinanceImportBatch.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function listImportedData(sourceType, query = {}) {
  const source = importedDataSources[sourceType];
  if (!source) return toPaginatedResult({ items: [], total: 0, page: 1, limit: 20 });
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = withDateRange(buildScopeFilter(query), source.dateField, query);
  const [items, total] = await Promise.all([
    source.model.find(filter)
      .sort({ [source.dateField]: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    source.model.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function completeImportBatch(batchId, summary) {
  return FinanceImportBatch.findOneAndUpdate({ _id: batchId, status: 'PROCESSING' }, {
    $set: {
      status: summary.status,
      processedRows: summary.processedRows,
      validRows: summary.validRows,
      skippedRows: summary.skippedRows,
      unlinkedRows: summary.unlinkedRows,
      upserted: summary.upserted,
      errorCount: summary.errors.length,
      errors: summary.errors,
      finishedAt: new Date(),
    },
  }, { returnDocument: 'after', runValidators: true }).lean();
}

async function upsertSettlement(payload) {
  return upsert(MarketplaceSettlement, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    settlementId: payload.settlementId,
  }, payload);
}

async function upsertLedgerLine(payload) {
  return upsert(MarketplaceSettlementLedgerLine, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    sourceRef: payload.sourceRef,
    'rawReference.importKey': payload.rawReference?.importKey,
  }, payload);
}

async function upsertFeeLine(payload) {
  return upsert(MarketplaceFeeLine, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    sourceRef: payload.sourceRef,
    'rawReference.importKey': payload.rawReference?.importKey,
  }, payload);
}

async function upsertRefundRecord(payload) {
  return upsert(RefundRecord, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    externalRefundId: payload.externalRefundId,
  }, payload);
}

async function upsertAdsSpend(payload) {
  return upsert(AdsSpendDaily, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    reportDate: payload.reportDate,
    campaignName: payload.campaignName,
  }, payload);
}

async function sumFeesByOrderItem(orderItemId) {
  const _id = new mongoose.Types.ObjectId(String(orderItemId));
  const result = await MarketplaceFeeLine.aggregate([
    { $match: { orderItemId: _id } },
    { $group: { _id: null, total: { $sum: '$totalFeeAmount' } } },
  ]);
  return result.length ? result[0].total : null;
}

async function sumRefundsByOrderItem(orderItemId) {
  const _id = new mongoose.Types.ObjectId(String(orderItemId));
  const result = await RefundRecord.aggregate([
    { $match: { orderItemId: _id } },
    { $group: { _id: null, total: { $sum: '$totalRefundAmount' } } },
  ]);
  return result.length ? result[0].total : null;
}

module.exports = {
  buildScopeFilter,
  completeImportBatch,
  createImportBatch,
  findImportBatchById,
  listImportBatches,
  listImportedData,
  sumFeesByOrderItem,
  sumRefundsByOrderItem,
  upsertAdsSpend,
  upsertFeeLine,
  upsertLedgerLine,
  upsertRefundRecord,
  upsertSettlement,
};
