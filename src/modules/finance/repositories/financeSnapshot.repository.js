const FinanceSnapshot = require('../models/financeSnapshot.model');
const AdsSpendDaily = require('../models/adsSpendDaily.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.orderId) filter.orderId = toObjectId(query.orderId);
  if (query.orderItemId) filter.orderItemId = toObjectId(query.orderItemId);
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  if (query.snapshotStatus) filter.snapshotStatus = query.snapshotStatus;
  if (query.costStatus) filter.costStatus = query.costStatus;
  if (query.dateFrom || query.dateTo) {
    filter.calculatedAt = {};
    if (query.dateFrom) filter.calculatedAt.$gte = query.dateFrom;
    if (query.dateTo) filter.calculatedAt.$lte = query.dateTo;
  }
  return filter;
}

async function findByOrderItem(orderItemId) {
  return FinanceSnapshot.findOne({ orderItemId }).lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  return FinanceSnapshot.find({ orderItemId: { $in: orderItemIds } }).lean();
}

async function listByOrder(orderId) {
  return FinanceSnapshot.find({ orderId }).sort({ calculatedAt: -1, _id: -1 }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    FinanceSnapshot.find(filter)
      .sort({ calculatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    FinanceSnapshot.countDocuments(filter),
  ]);
  return toPaginatedResult({
    items, total, page, limit,
  });
}

async function summarizeDaily(query = {}) {
  const filter = buildFilter(query);
  return FinanceSnapshot.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$calculatedAt' } },
          shopId: '$shopId',
          salesChannelCode: '$salesChannelCode',
          marketplaceCode: '$marketplaceCode',
          currency: '$currency',
        },
        itemCount: { $sum: 1 },
        revenueAmount: { $sum: '$customerPaidAmount' },
        baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
        grossProfitAmount: { $sum: { $ifNull: ['$grossProfitAmount', 0] } },
        missingCostCount: {
          $sum: { $cond: [{ $eq: ['$snapshotStatus', 'MISSING_COST'] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id.date',
        shopId: '$_id.shopId',
        salesChannelCode: '$_id.salesChannelCode',
        marketplaceCode: '$_id.marketplaceCode',
        currency: '$_id.currency',
        itemCount: 1,
        revenueAmount: 1,
        baseCostAmount: 1,
        grossProfitAmount: 1,
        grossMarginBps: {
          $cond: [
            { $gt: ['$revenueAmount', 0] },
            { $round: [{ $multiply: [{ $divide: ['$grossProfitAmount', '$revenueAmount'] }, 10000] }, 0] },
            null,
          ],
        },
        missingCostCount: 1,
      },
    },
    { $sort: { date: 1, salesChannelCode: 1, marketplaceCode: 1 } },
  ]);
}

function dailyKey(row = {}) {
  return [row.date, String(row.shopId), row.salesChannelCode, row.marketplaceCode, row.currency].join('|');
}

function buildAdsFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  if (query.dateFrom || query.dateTo) {
    filter.reportDate = {};
    if (query.dateFrom) filter.reportDate.$gte = query.dateFrom;
    if (query.dateTo) filter.reportDate.$lte = query.dateTo;
  }
  return filter;
}

async function summarizeDailyProfit(query = {}) {
  const [financeRows, adRows] = await Promise.all([
    summarizeDaily(query),
    AdsSpendDaily.aggregate([
      { $match: buildAdsFilter(query) },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$reportDate' } },
            shopId: '$shopId',
            salesChannelCode: '$salesChannelCode',
            marketplaceCode: '$marketplaceCode',
            currency: '$currency',
          },
          adSpendAmount: { $sum: '$spendAmount' },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id.date',
          shopId: '$_id.shopId',
          salesChannelCode: '$_id.salesChannelCode',
          marketplaceCode: '$_id.marketplaceCode',
          currency: '$_id.currency',
          adSpendAmount: 1,
        },
      },
    ]),
  ]);
  const rows = new Map();
  financeRows.forEach((row) => rows.set(dailyKey(row), { ...row, adSpendAmount: 0 }));
  adRows.forEach((row) => {
    const key = dailyKey(row);
    const current = rows.get(key) || {
      ...row,
      itemCount: 0,
      revenueAmount: 0,
      baseCostAmount: 0,
      grossProfitAmount: 0,
      grossMarginBps: null,
      missingCostCount: 0,
    };
    rows.set(key, { ...current, adSpendAmount: row.adSpendAmount || 0 });
  });
  return [...rows.values()]
    .map((row) => {
      const netProfitAmount = (row.grossProfitAmount || 0) - (row.adSpendAmount || 0);
      return {
        ...row,
        netProfitAmount,
        netMarginBps: row.revenueAmount > 0 ? Math.round((netProfitAmount / row.revenueAmount) * 10000) : null,
      };
    })
    .sort((left, right) => dailyKey(left).localeCompare(dailyKey(right)));
}

function totalsProjection() {
  return {
    itemCount: { $sum: 1 },
    revenueAmount: { $sum: '$customerPaidAmount' },
    baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
    grossProfitAmount: { $sum: { $ifNull: ['$grossProfitAmount', 0] } },
    missingCostCount: {
      $sum: { $cond: [{ $eq: ['$snapshotStatus', 'MISSING_COST'] }, 1, 0] },
    },
  };
}

function marginProjection() {
  return {
    $cond: [
      { $gt: ['$revenueAmount', 0] },
      { $round: [{ $multiply: [{ $divide: ['$grossProfitAmount', '$revenueAmount'] }, 10000] }, 0] },
      null,
    ],
  };
}

async function summarizeBySeller(query = {}) {
  const filter = buildFilter(query);
  return FinanceSnapshot.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          sellerEmployeeCode: '$sellerEmployeeCode',
          sellerAccountId: '$sellerAccountId',
          sellerName: '$sellerName',
          currency: '$currency',
        },
        ...totalsProjection(),
      },
    },
    {
      $project: {
        _id: 0,
        sellerEmployeeCode: '$_id.sellerEmployeeCode',
        sellerAccountId: '$_id.sellerAccountId',
        sellerName: '$_id.sellerName',
        currency: '$_id.currency',
        itemCount: 1,
        revenueAmount: 1,
        baseCostAmount: 1,
        grossProfitAmount: 1,
        grossMarginBps: marginProjection(),
        missingCostCount: 1,
      },
    },
    { $sort: { sellerEmployeeCode: 1, sellerName: 1 } },
  ]);
}

async function findDateBounds(query = {}) {
  const [bounds] = await FinanceSnapshot.aggregate([
    { $match: buildFilter(query) },
    {
      $group: {
        _id: null,
        dateFrom: { $min: '$calculatedAt' },
        dateTo: { $max: '$calculatedAt' },
      },
    },
    { $project: { _id: 0, dateFrom: 1, dateTo: 1 } },
  ]);
  return bounds || null;
}

async function summarizeByTeam(query = {}) {
  const filter = buildFilter(query);
  return FinanceSnapshot.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          teamId: '$teamId',
          teamName: '$teamName',
          teamCode: '$teamCode',
          departmentId: '$departmentId',
          departmentName: '$departmentName',
          departmentCode: '$departmentCode',
          currency: '$currency',
        },
        ...totalsProjection(),
      },
    },
    {
      $project: {
        _id: 0,
        teamId: '$_id.teamId',
        teamName: '$_id.teamName',
        teamCode: '$_id.teamCode',
        departmentId: '$_id.departmentId',
        departmentName: '$_id.departmentName',
        departmentCode: '$_id.departmentCode',
        currency: '$_id.currency',
        itemCount: 1,
        revenueAmount: 1,
        baseCostAmount: 1,
        grossProfitAmount: 1,
        grossMarginBps: marginProjection(),
        missingCostCount: 1,
      },
    },
    { $sort: { teamCode: 1, teamName: 1 } },
  ]);
}

async function upsertByOrderItem(orderItemId, payload) {
  return FinanceSnapshot.findOneAndUpdate(
    { orderItemId },
    { $set: payload },
    {
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  ).lean();
}

module.exports = {
  buildFilter,
  findByOrderItem,
  findDateBounds,
  list,
  listByOrder,
  listByOrderItemIds,
  summarizeBySeller,
  summarizeByTeam,
  summarizeDaily,
  summarizeDailyProfit,
  upsertByOrderItem,
};
