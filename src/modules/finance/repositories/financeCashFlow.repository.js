const mongoose = require('mongoose');
const FinanceImportBatch = require('../models/financeImportBatch.model');
const MarketplaceFeeLine = require('../models/marketplaceFeeLine.model');
const MarketplaceSettlement = require('../models/marketplaceSettlement.model');
const MarketplaceSettlementLedgerLine = require('../models/marketplaceSettlementLedgerLine.model');
const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function scopeFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  if (query.currency) filter.currency = query.currency;
  return filter;
}

function withDateRange(filter, field, query = {}) {
  if (!query.dateFrom && !query.dateTo) return filter;
  filter[field] = {};
  if (query.dateFrom) filter[field].$gte = new Date(query.dateFrom);
  if (query.dateTo) filter[field].$lte = new Date(query.dateTo);
  return filter;
}

function reconciliationStatus(row = {}) {
  if (row.orderItemId) return 'LINKED';
  if (row.orderId) return 'NEEDS_REVIEW';
  return 'UNLINKED';
}

function reconciliationExpression() {
  return {
    $switch: {
      branches: [
        { case: { $ne: ['$orderItemId', null] }, then: 'LINKED' },
        { case: { $ne: ['$orderId', null] }, then: 'NEEDS_REVIEW' },
      ],
      default: 'UNLINKED',
    },
  };
}

function movementProjection({ sourceKind, amount }) {
  return {
    _id: 1,
    occurredAt: '$postedAt',
    sourceKind,
    amount,
    currency: { $ifNull: ['$currency', 'USD'] },
    orderId: { $ifNull: ['$orderId', null] },
    orderItemId: { $ifNull: ['$orderItemId', null] },
    externalOrderId: { $ifNull: ['$externalOrderId', null] },
    settlementId: { $ifNull: ['$settlementId', null] },
    settlementRecordId: { $ifNull: ['$marketplaceSettlementId', null] },
    sourceRef: { $ifNull: ['$sourceRef', null] },
    importBatchId: { $ifNull: ['$importBatchId', null] },
    reason: { $ifNull: ['$feeType', '$amountType'] },
  };
}

function movementPipeline(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const ledgerFilter = withDateRange(scopeFilter(query), 'postedAt', query);
  const feeFilter = withDateRange(scopeFilter(query), 'postedAt', query);
  const feeCollection = MarketplaceFeeLine.collection.name;
  const stages = [
    { $match: ledgerFilter },
    {
      $project: movementProjection({
        sourceKind: { $cond: [{ $eq: ['$ledgerCategory', 'TRANSACTION'] }, 'TRANSACTION', 'SETTLEMENT_ACTIVITY'] },
        amount: { $ifNull: ['$amount', 0] },
      }),
    },
    { $addFields: { reconciliationStatus: reconciliationExpression() } },
    {
      $unionWith: {
        coll: feeCollection,
        pipeline: [
          { $match: feeFilter },
          {
            $project: movementProjection({
              sourceKind: 'FEE',
              amount: { $multiply: [-1, { $ifNull: ['$totalFeeAmount', 0] }] },
            }),
          },
          { $addFields: { reconciliationStatus: reconciliationExpression() } },
        ],
      },
    },
  ];
  if (query.status) stages.push({ $match: { reconciliationStatus: query.status } });
  stages.push({
    $facet: {
      items: [{ $sort: { occurredAt: -1, _id: -1 } }, { $skip: getPaginationOffset({ page, limit }) }, { $limit: limit }],
      total: [{ $count: 'count' }],
      summaryByCurrency: [
        {
          $group: {
            _id: '$currency',
            transactionNetAmount: { $sum: { $cond: [{ $eq: ['$sourceKind', 'TRANSACTION'] }, '$amount', 0] } },
            feeAmount: { $sum: { $cond: [{ $eq: ['$sourceKind', 'FEE'] }, '$amount', 0] } },
            unlinkedCount: { $sum: { $cond: [{ $eq: ['$reconciliationStatus', 'UNLINKED'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ],
    },
  });
  return stages;
}

async function settlementSummary(query = {}) {
  const settlementFilter = withDateRange(scopeFilter(query), 'depositAt', query);
  const ledgerCollection = MarketplaceSettlementLedgerLine.collection.name;
  const rows = await MarketplaceSettlement.aggregate([
    { $match: settlementFilter },
    {
      $lookup: {
        from: ledgerCollection,
        let: { settlementId: '$settlementId', shopId: '$shopId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$settlementId', '$$settlementId'] },
                  { $eq: ['$shopId', '$$shopId'] },
                ],
              },
            },
          },
          { $group: { _id: null, netAmount: { $sum: '$amount' } } },
        ],
        as: 'ledger',
      },
    },
    {
      $project: {
        currency: { $ifNull: ['$currency', 'USD'] },
        payoutAmount: {
          $cond: [{ $ne: [{ $ifNull: ['$netSettlementAmount', 0] }, 0] }, '$netSettlementAmount', '$totalAmount'],
        },
        ledgerNetAmount: { $ifNull: [{ $arrayElemAt: ['$ledger.netAmount', 0] }, 0] },
      },
    },
    {
      $group: {
        _id: '$currency',
        settlementPayoutAmount: { $sum: { $ifNull: ['$payoutAmount', 0] } },
        payoutVarianceCount: { $sum: { $cond: [{ $ne: ['$payoutAmount', '$ledgerNetAmount'] }, 1, 0] } },
      },
    },
  ]);
  return rows || [];
}

async function importErrorCount(query = {}) {
  const filter = withDateRange(scopeFilter(query), 'createdAt', query);
  filter.status = { $in: ['FAILED', 'PARTIAL_FAILED'] };
  const [result] = await FinanceImportBatch.aggregate([
    { $match: filter },
    { $group: { _id: null, count: { $sum: { $ifNull: ['$errorCount', 0] } } } },
  ]);
  return result?.count || 0;
}

async function getCashFlow(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const [movementResult, settlementRows, errors] = await Promise.all([
    MarketplaceSettlementLedgerLine.aggregate(movementPipeline(query)),
    settlementSummary(query),
    importErrorCount(query),
  ]);
  const movement = movementResult?.[0] || { items: [], total: [], summaryByCurrency: [] };
  const summaries = new Map((movement.summaryByCurrency || []).map((row) => [row._id || 'USD', {
    currency: row._id || 'USD',
    transactionNetAmount: row.transactionNetAmount || 0,
    feeAmount: row.feeAmount || 0,
    settlementPayoutAmount: 0,
    unlinkedCount: row.unlinkedCount || 0,
    payoutVarianceCount: 0,
  }]));
  for (const row of settlementRows) {
    const currency = row._id || 'USD';
    const summary = summaries.get(currency) || {
      currency,
      transactionNetAmount: 0,
      feeAmount: 0,
      settlementPayoutAmount: 0,
      unlinkedCount: 0,
      payoutVarianceCount: 0,
    };
    summary.settlementPayoutAmount = row.settlementPayoutAmount || 0;
    summary.payoutVarianceCount = row.payoutVarianceCount || 0;
    summaries.set(currency, summary);
  }
  return {
    summaryByCurrency: [...summaries.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
    importErrorCount: errors,
    items: (movement.items || []).map((row) => ({ ...row, reconciliationStatus: reconciliationStatus(row) })),
    pagination: { total: movement.total?.[0]?.count || 0, page, limit },
  };
}

module.exports = { getCashFlow, movementPipeline, reconciliationStatus, scopeFilter };
