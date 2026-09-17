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

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function cleanNulls(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function upsert(model, filter, payload, overwrite = false) {
  return model.findOneAndUpdate(
    filter,
    overwrite ? { $set: cleanNulls(payload) } : { $setOnInsert: cleanNulls(payload) },
    {
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
      timestamps: false,
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

async function findImportBatchByIdempotency({ shopId, sourceType, idempotencyKey }) {
  return FinanceImportBatch.findOne({
    shopId: toObjectId(shopId),
    sourceType,
    idempotencyKey,
  }).lean();
}

async function findImportBatchByContentHash({ shopId, sourceType, contentHash }) {
  return FinanceImportBatch.findOne({
    shopId: toObjectId(shopId),
    sourceType,
    contentHash,
  }).sort({ createdAt: -1, _id: -1 }).lean();
}

async function findActiveImportBatch({ shopId, sourceType }) {
  return FinanceImportBatch.findOne({
    shopId: toObjectId(shopId),
    sourceType,
    status: { $in: ['QUEUED', 'PROCESSING'] },
  }).lean();
}

async function initializeImportBatchRecalculation(batchId, total) {
  return FinanceImportBatch.findOneAndUpdate({ _id: batchId }, {
    $set: {
      recalculationStatus: total > 0 ? 'PROCESSING' : 'NOT_REQUIRED',
      recalculationTotal: total,
      recalculationCompleted: 0,
      recalculationFailed: 0,
      recalculationErrors: [],
    },
  }, { returnDocument: 'after', runValidators: true }).lean();
}

async function markImportBatchRecalculationCompleted(batchId, orderItemId) {
  const batch = await FinanceImportBatch.findOneAndUpdate({ _id: batchId }, {
    $inc: { recalculationCompleted: 1 },
  }, { returnDocument: 'after', runValidators: true }).lean();
  return finalizeImportBatchRecalculation(batch);
}

async function markImportBatchRecalculationFailed(batchId, orderItemId, error) {
  const batch = await FinanceImportBatch.findOneAndUpdate({ _id: batchId }, {
    $inc: { recalculationFailed: 1 },
    $push: { recalculationErrors: { orderItemId: String(orderItemId), message: error?.message || String(error) } },
  }, { returnDocument: 'after', runValidators: true }).lean();
  return finalizeImportBatchRecalculation(batch);
}

async function finalizeImportBatchRecalculation(batch) {
  if (!batch || batch.recalculationStatus === 'NOT_REQUIRED') return batch;
  const processed = (batch.recalculationCompleted || 0) + (batch.recalculationFailed || 0);
  if (processed < (batch.recalculationTotal || 0)) return batch;
  return FinanceImportBatch.findOneAndUpdate({
    _id: batch._id,
    recalculationStatus: 'PROCESSING',
  }, {
    $set: { recalculationStatus: batch.recalculationFailed ? 'PARTIAL_FAILED' : 'COMPLETED' },
  }, { returnDocument: 'after', runValidators: true }).lean();
}

async function claimQueuedImportBatch(batchId) {
  return FinanceImportBatch.findOneAndUpdate(
    { _id: batchId, status: 'QUEUED' },
    { $set: { status: 'PROCESSING' } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

function updateImportProgress(batchId, progress) {
  return FinanceImportBatch.updateOne(
    { _id: batchId, status: 'PROCESSING' },
    { $set: { processedRows: progress.processedRows, validRows: progress.validRows, skippedRows: progress.skippedRows, errorCount: progress.errorCount } },
    { runValidators: true },
  );
}

async function failImportBatch(batchId, summary) {
  return FinanceImportBatch.findOneAndUpdate({
    _id: batchId,
    status: { $in: ['QUEUED', 'PROCESSING'] },
  }, {
    $set: {
      status: 'FAILED',
      processedRows: summary.processedRows || 0,
      validRows: summary.validRows || 0,
      skippedRows: summary.skippedRows || 0,
      unlinkedRows: summary.unlinkedRows || 0,
      upserted: summary.upserted || {},
      errorCount: summary.errors?.length || 0,
      errors: summary.errors || [],
      finishedAt: new Date(),
    },
    $unset: { activeKey: 1 },
  }, { returnDocument: 'after', runValidators: true }).lean();
}

async function findCompletedImportBatchBySourceRef(sourceType, sourceRef) {
  return FinanceImportBatch.findOne({ sourceType, sourceRef, status: 'COMPLETED' }).lean();
}

async function findCompletedSettlementImport({ shopId, referenceId }) {
  return FinanceImportBatch.findOne({
    shopId,
    sourceType: 'SETTLEMENTS',
    sourceRef: `settlements-${referenceId}.txt`,
    status: 'COMPLETED',
  }).lean();
}

async function listSourceReferencesByOrderItem(orderItemId) {
  const filter = { orderItemId: toObjectId(orderItemId) };
  const [ledgerLines, feeLines, refunds] = await Promise.all([
    MarketplaceSettlementLedgerLine.find(filter)
      .select('sourceRef importBatchId sourceType postedAt settlementId amount').sort({ postedAt: -1, _id: -1 }).lean(),
    MarketplaceFeeLine.find(filter)
      .select('sourceRef importBatchId sourceType postedAt settlementId feeType totalFeeAmount').sort({ postedAt: -1, _id: -1 }).lean(),
    RefundRecord.find(filter)
      .select('sourceRef importBatchId sourceType refundedAt externalRefundId totalRefundAmount').sort({ refundedAt: -1, _id: -1 }).lean(),
  ]);
  return [
    ...ledgerLines.map((row) => ({ sourceKind: 'LEDGER', sourceRef: row.sourceRef || null, importBatchId: toId(row.importBatchId), occurredAt: row.postedAt || null, settlementId: row.settlementId || null, amount: row.amount || 0 })),
    ...feeLines.map((row) => ({ sourceKind: 'FEE', sourceRef: row.sourceRef || null, importBatchId: toId(row.importBatchId), occurredAt: row.postedAt || null, settlementId: row.settlementId || null, category: row.feeType || null, amount: row.totalFeeAmount || 0 })),
    ...refunds.map((row) => ({ sourceKind: 'REFUND', sourceRef: row.sourceRef || null, importBatchId: toId(row.importBatchId), occurredAt: row.refundedAt || null, externalReference: row.externalRefundId || null, amount: row.totalRefundAmount || 0 })),
  ];
}

async function linkUnlinkedFinanceRowsForOrderItem({
  shopId, salesChannelCode, marketplaceCode, externalOrderId, externalItemId, sku, orderId, orderItemId, listingId,
}) {
  const identity = { shopId, salesChannelCode, marketplaceCode, orderItemId: null };
  const matches = [];
  if (externalItemId) matches.push({ externalItemId });
  if (externalOrderId && sku) matches.push({ externalOrderId, sku });
  if (!matches.length) return { linkedCount: 0 };
  identity.$or = matches;
  const update = { $set: { orderId, orderItemId, listingId: listingId || null } };
  const results = await Promise.all([
    MarketplaceSettlementLedgerLine.updateMany(identity, update),
    MarketplaceFeeLine.updateMany(identity, update),
    RefundRecord.updateMany(identity, update),
  ]);
  return { linkedCount: results.reduce((sum, result) => sum + (result.matchedCount ?? result.n ?? 0), 0) };
}

function buildScopeFilter(query = {}) {
  const filter = {};
  if (query.importBatchId) filter.importBatchId = toObjectId(query.importBatchId);
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

async function settlementLedgerSummary(filter) {
  const [result] = await MarketplaceSettlementLedgerLine.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        inflowAmount: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
        outflowAmount: { $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] } },
        netAmount: { $sum: '$amount' },
        lineCount: { $sum: 1 },
        linkedCount: { $sum: { $cond: [{ $ne: ['$orderItemId', null] }, 1, 0] } },
      },
    },
  ]);
  const summary = result || {};
  return {
    inflowAmount: summary.inflowAmount || 0,
    outflowAmount: summary.outflowAmount || 0,
    netAmount: summary.netAmount || 0,
    lineCount: summary.lineCount || 0,
    linkedCount: summary.linkedCount || 0,
    unlinkedCount: Math.max((summary.lineCount || 0) - (summary.linkedCount || 0), 0),
  };
}

async function listSettlements(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = withDateRange(buildScopeFilter(query), 'depositAt', query);
  if (query.settlementId) filter.settlementId = String(query.settlementId);
  if (query.reconciliationStatus) filter.reconciliationStatus = query.reconciliationStatus;

  if (query.hasVariance || query.hasUnlinkedRows) {
    // ponytail: this scans the filtered settlement IDs; move this predicate into a Mongo lookup when a shop has enough settlements to make it material.
    const candidates = await MarketplaceSettlement.find(filter)
      .select({ settlementId: 1, totalAmount: 1, netSettlementAmount: 1 })
      .lean();
    const settlementIds = candidates.map((item) => item.settlementId).filter(Boolean);
    const ledgerGroups = settlementIds.length
      ? await MarketplaceSettlementLedgerLine.aggregate([
        { $match: { ...buildScopeFilter(query), settlementId: { $in: settlementIds } } },
        {
          $group: {
            _id: '$settlementId',
            netAmount: { $sum: '$amount' },
            lineCount: { $sum: 1 },
            linkedCount: { $sum: { $cond: [{ $ne: ['$orderItemId', null] }, 1, 0] } },
          },
        },
      ])
      : [];
    const ledgerBySettlement = new Map(ledgerGroups.map((group) => [String(group._id), group]));
    filter.settlementId = {
      $in: candidates
        .filter((item) => {
          const group = ledgerBySettlement.get(String(item.settlementId)) || {};
          const hasVariance = (group.netAmount || 0) !== (item.totalAmount ?? item.netSettlementAmount ?? 0);
          const hasUnlinkedRows = (group.lineCount || 0) > (group.linkedCount || 0);
          return (!query.hasVariance || hasVariance) && (!query.hasUnlinkedRows || hasUnlinkedRows);
        })
        .map((item) => item.settlementId),
    };
  }

  const [items, total, currencySummary] = await Promise.all([
    MarketplaceSettlement.find(filter)
      .sort({ depositAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    MarketplaceSettlement.countDocuments(filter),
    MarketplaceSettlement.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$currency',
          settlementCount: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$totalAmount', 0] } },
          netSettlementAmount: { $sum: { $ifNull: ['$netSettlementAmount', '$totalAmount'] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const settlementIds = items.map((item) => item.settlementId).filter(Boolean);
  const ledgerGroups = settlementIds.length
    ? await MarketplaceSettlementLedgerLine.aggregate([
      {
        $match: {
          ...buildScopeFilter(query),
          settlementId: { $in: settlementIds },
        },
      },
      {
        $group: {
          _id: '$settlementId',
          inflowAmount: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
          outflowAmount: { $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] } },
          netAmount: { $sum: '$amount' },
          lineCount: { $sum: 1 },
          linkedCount: { $sum: { $cond: [{ $ne: ['$orderItemId', null] }, 1, 0] } },
        },
      },
    ])
    : [];
  const ledgerBySettlement = new Map(ledgerGroups.map((group) => [String(group._id), group]));
  const enriched = items.map((item) => ({
      ...item,
      ledgerSummary: (() => {
        const group = ledgerBySettlement.get(String(item.settlementId)) || {};
        const lineCount = group.lineCount || 0;
        const linkedCount = group.linkedCount || 0;
        return {
          inflowAmount: group.inflowAmount || 0,
          outflowAmount: group.outflowAmount || 0,
          netAmount: group.netAmount || 0,
          lineCount,
          linkedCount,
          unlinkedCount: Math.max(lineCount - linkedCount, 0),
        };
      })(),
    }));
  return toPaginatedResult({
    items: enriched,
    total,
    page,
    limit,
    summaryByCurrency: currencySummary.map((row) => ({
      currency: row._id || 'USD',
      settlementCount: row.settlementCount || 0,
      totalAmount: row.totalAmount || 0,
      netSettlementAmount: row.netSettlementAmount || 0,
    })),
  });
}

async function getSettlement(settlementObjectId) {
  return MarketplaceSettlement.findById(settlementObjectId).lean();
}

async function updateSettlementReconciliation(settlementId, reconciliation) {
  return MarketplaceSettlement.findByIdAndUpdate(settlementId, { $set: reconciliation }, { new: true }).lean();
}

async function listSettlementLedgerLines(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = withDateRange(buildScopeFilter(query), 'postedAt', query);
  filter.settlementId = String(query.settlementId);
  if (query.linkState === 'UNLINKED') filter.orderItemId = null;
  const [items, total, summary] = await Promise.all([
    MarketplaceSettlementLedgerLine.find(filter)
      .sort({ postedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    MarketplaceSettlementLedgerLine.countDocuments(filter),
    settlementLedgerSummary(filter),
  ]);
  return { ...toPaginatedResult({ items, total, page, limit }), summary };
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
    $unset: { activeKey: 1 },
  }, { returnDocument: 'after', runValidators: true }).lean();
}

async function upsertSettlement(payload) {
  return upsert(MarketplaceSettlement, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    settlementId: payload.settlementId,
  }, payload, true);
}

async function upsertLedgerLine(payload) {
  const dedupKey = payload.rawReference?.dedupKey;
  const transaction = payload.ledgerCategory === 'TRANSACTION' && dedupKey;
  const settlementActivity = payload.ledgerCategory === 'SETTLEMENT_ACTIVITY' && dedupKey;
  return upsert(MarketplaceSettlementLedgerLine, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    ...(transaction || settlementActivity
      ? { ledgerCategory: payload.ledgerCategory, 'rawReference.dedupKey': dedupKey }
      : { sourceRef: payload.sourceRef, 'rawReference.importKey': payload.rawReference?.importKey }),
  }, payload, Boolean(transaction || settlementActivity));
}

async function upsertFeeLine(payload) {
  const dedupKey = payload.rawReference?.dedupKey;
  return upsert(MarketplaceFeeLine, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    ...(dedupKey
      ? { feeType: payload.feeType, 'rawReference.dedupKey': dedupKey }
      : { sourceRef: payload.sourceRef, 'rawReference.importKey': payload.rawReference?.importKey }),
  }, payload, Boolean(dedupKey));
}

async function upsertRefundRecord(payload) {
  return upsert(RefundRecord, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    externalRefundId: payload.externalRefundId,
  }, payload, Boolean(payload.rawReference?.dedupKey));
}

async function findRefundById(refundId) {
  return RefundRecord.findById(refundId).lean();
}

async function setRefundAllocations(refundId, allocations, { session } = {}) {
  return RefundRecord.findByIdAndUpdate(refundId, { $set: { allocations } }, { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) }).lean();
}
async function setRefundAllocationsIfUnallocated(refundId, totalRefundAmount, allocations, { session } = {}) {
  return RefundRecord.findOneAndUpdate({ _id: refundId, orderItemId: null, 'allocations.0': { $exists: false }, totalRefundAmount }, { $set: { allocations } }, { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) }).lean();
}
async function listUnallocatedOrderRefunds({ shopId, salesChannelCode, marketplaceCode, externalOrderId }) {
  return RefundRecord.find({ shopId: toObjectId(shopId), salesChannelCode, marketplaceCode, externalOrderId, orderItemId: null, 'allocations.0': { $exists: false } }).sort({ refundedAt: 1, _id: 1 }).lean();
}
async function listUnallocatedRefunds(query = {}) {
  const filter = { orderItemId: null, $expr: { $lt: [{ $sum: '$allocations.amount' }, '$totalRefundAmount'] } };
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  return RefundRecord.find(filter).sort({ refundedAt: -1, _id: -1 }).limit(100).lean();
}

async function listRefundReviewRecords(query = {}) {
  const filter = {
    $or: [
      { orderItemId: { $ne: null }, 'allocations.0': { $exists: false } },
      { 'allocations.0': { $exists: true } },
    ],
  };
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  return RefundRecord.find(filter).sort({ refundedAt: -1, _id: -1 }).limit(500).lean();
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
    {
      $match: {
        $or: [
          { orderItemId: _id, 'allocations.0': { $exists: false } },
          { 'allocations.orderItemId': _id },
        ],
      },
    },
    {
      $project: {
        allocatedAmount: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ['$allocations', []] } }, 0] },
            { $sum: { $map: { input: { $filter: { input: '$allocations', as: 'allocation', cond: { $eq: ['$$allocation.orderItemId', _id] } } }, as: 'allocation', in: '$$allocation.amount' } } },
            '$totalRefundAmount',
          ],
        },
      },
    },
    { $group: { _id: null, total: { $sum: '$allocatedAmount' } } },
  ]);
  return result.length ? result[0].total : null;
}

module.exports = {
  buildScopeFilter,
  completeImportBatch,
  createImportBatch,
  claimQueuedImportBatch,
  updateImportProgress,
  failImportBatch,
  findActiveImportBatch,
  findImportBatchByContentHash,
  findImportBatchByIdempotency,
  findImportBatchById,
  findCompletedImportBatchBySourceRef,
  findCompletedSettlementImport,
  listSourceReferencesByOrderItem,
  initializeImportBatchRecalculation,
  linkUnlinkedFinanceRowsForOrderItem,
  listImportBatches,
  listSettlements,
  getSettlement,
  updateSettlementReconciliation,
  listSettlementLedgerLines,
  listImportedData,
  markImportBatchRecalculationCompleted,
  markImportBatchRecalculationFailed,
  sumFeesByOrderItem,
  sumRefundsByOrderItem,
  upsertAdsSpend,
  upsertFeeLine,
  upsertLedgerLine,
  upsertRefundRecord,
  findRefundById,
  setRefundAllocations,
  setRefundAllocationsIfUnallocated,
  listUnallocatedRefunds,
  listUnallocatedOrderRefunds,
  listRefundReviewRecords,
  upsertSettlement,
};
