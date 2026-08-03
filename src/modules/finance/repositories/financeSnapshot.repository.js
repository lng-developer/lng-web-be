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
  if (Array.isArray(query.orderItemIds)) filter.orderItemId = { $in: query.orderItemIds.map(toObjectId) };
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (Array.isArray(query.shopIds)) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  if (query.sellerEmployeeCode) filter.sellerEmployeeCode = query.sellerEmployeeCode;
  if (query.teamId) filter.teamId = toObjectId(query.teamId);
  if (query.departmentId) filter.departmentId = toObjectId(query.departmentId);
  if (query.sellerAccountId) filter.sellerAccountId = toObjectId(query.sellerAccountId);
  if (Array.isArray(query.accessOr)) {
    if (!query.accessOr.length) filter._id = { $exists: false };
    else filter.$or = query.accessOr.map((condition) => Object.fromEntries(
      Object.entries(condition).map(([key, value]) => [key, toObjectId(value)]),
    ));
  }
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

async function listFilterOptions(query = {}) {
  const [result = {}] = await FinanceSnapshot.aggregate([
    { $match: buildFilter(query) },
    {
      $facet: {
        channels: [
          { $match: { salesChannelCode: { $ne: null } } },
          { $group: { _id: '$salesChannelCode' } },
          { $sort: { _id: 1 } },
        ],
        marketplaces: [
          { $match: { marketplaceCode: { $ne: null } } },
          { $group: { _id: '$marketplaceCode' } },
          { $sort: { _id: 1 } },
        ],
        sellers: [
          { $match: { sellerEmployeeCode: { $ne: null } } },
          { $group: { _id: '$sellerEmployeeCode', name: { $first: '$sellerName' } } },
          { $sort: { _id: 1 } },
        ],
        teams: [
          { $match: { teamId: { $ne: null } } },
          { $group: { _id: '$teamId', name: { $first: '$teamName' }, code: { $first: '$teamCode' } } },
          { $sort: { code: 1, name: 1 } },
        ],
        departments: [
          { $match: { departmentId: { $ne: null } } },
          { $group: { _id: '$departmentId', name: { $first: '$departmentName' }, code: { $first: '$departmentCode' } } },
          { $sort: { code: 1, name: 1 } },
        ],
      },
    },
  ]);
  return {
    channels: (result.channels || []).map((row) => row._id),
    marketplaces: (result.marketplaces || []).map((row) => row._id),
    sellers: (result.sellers || []).map((row) => ({ employeeCode: row._id, name: row.name || null })),
    teams: (result.teams || []).map((row) => ({ id: String(row._id), name: row.name || null, code: row.code || null })),
    departments: (result.departments || []).map((row) => ({ id: String(row._id), name: row.name || null, code: row.code || null })),
  };
}

async function summarizeOrderPnl(query = {}) {
  const filter = buildFilter(query);
  return FinanceSnapshot.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$currency',
        revenueAmount: { $sum: '$customerPaidAmount' },
        marketplaceFeeAmount: { $sum: { $ifNull: ['$feeAmount', 0] } },
        refundAmount: { $sum: { $ifNull: ['$refundAmount', 0] } },
        discountAmount: { $sum: { $ifNull: ['$discountAmount', 0] } },
        baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
        totalCostAmount: { $sum: { $ifNull: ['$totalCostAmount', 0] } },
        additionalFulfillmentCostAmount: {
          $sum: {
            $cond: [
              { $gt: [{ $ifNull: ['$totalCostAmount', 0] }, { $ifNull: ['$baseCostAmount', 0] }] },
              { $subtract: [{ $ifNull: ['$totalCostAmount', 0] }, { $ifNull: ['$baseCostAmount', 0] }] },
              0,
            ],
          },
        },
        missingCostCount: {
          $sum: {
            $cond: [
              { $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        currency: '$_id',
        revenueAmount: 1,
        marketplaceFeeAmount: 1,
        refundAmount: 1,
        discountAmount: 1,
        baseCostAmount: 1,
        totalCostAmount: {
          $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', null],
        },
        additionalFulfillmentCostAmount: {
          $cond: [{ $eq: ['$missingCostCount', 0] }, '$additionalFulfillmentCostAmount', null],
        },
        totalDeductionAmount: {
          $cond: [
            { $eq: ['$missingCostCount', 0] },
            { $add: ['$marketplaceFeeAmount', '$refundAmount', '$discountAmount', '$totalCostAmount'] },
            null,
          ],
        },
        profitAmount: {
          $cond: [
            { $eq: ['$missingCostCount', 0] },
            {
              $subtract: [
                '$revenueAmount',
                { $add: ['$marketplaceFeeAmount', '$refundAmount', '$discountAmount', '$totalCostAmount'] },
              ],
            },
            null,
          ],
        },
        missingCostCount: 1,
      },
    },
    { $sort: { currency: 1 } },
  ]);
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

async function summarizeAdsByChannel(query = {}) {
  return AdsSpendDaily.aggregate([
    { $match: buildAdsFilter(query) },
    {
      $group: {
        _id: {
          salesChannelCode: '$salesChannelCode',
          marketplaceCode: '$marketplaceCode',
          currency: '$currency',
        },
        spendAmount: { $sum: '$spendAmount' },
        attributedSalesAmount: { $sum: '$attributedSalesAmount' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        attributedOrdersCount: { $sum: '$orders7d' },
      },
    },
    {
      $project: {
        _id: 0,
        salesChannelCode: '$_id.salesChannelCode',
        marketplaceCode: '$_id.marketplaceCode',
        currency: '$_id.currency',
        spendAmount: 1,
        attributedSalesAmount: 1,
        impressions: 1,
        clicks: 1,
        attributedOrdersCount: 1,
      },
    },
    { $sort: { salesChannelCode: 1, marketplaceCode: 1, currency: 1 } },
  ]);
}

async function summarizeAdsDaily(query = {}) {
  return AdsSpendDaily.aggregate([
    { $match: buildAdsFilter(query) },
    {
      $group: {
        _id: {
          reportDate: { $dateToString: { format: '%Y-%m-%d', date: '$reportDate' } },
          salesChannelCode: '$salesChannelCode',
          marketplaceCode: '$marketplaceCode',
          currency: '$currency',
        },
        spendAmount: { $sum: '$spendAmount' },
        attributedSalesAmount: { $sum: '$attributedSalesAmount' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        attributedOrdersCount: { $sum: '$orders7d' },
      },
    },
    {
      $project: {
        _id: 0,
        reportDate: '$_id.reportDate',
        salesChannelCode: '$_id.salesChannelCode',
        marketplaceCode: '$_id.marketplaceCode',
        currency: '$_id.currency',
        spendAmount: 1,
        attributedSalesAmount: 1,
        impressions: 1,
        clicks: 1,
        attributedOrdersCount: 1,
      },
    },
    { $sort: { reportDate: 1, salesChannelCode: 1, marketplaceCode: 1, currency: 1 } },
  ]);
}

async function summarizeAdsBySeller(query = {}) {
  return AdsSpendDaily.aggregate([
    { $match: buildAdsFilter(query) },
    {
      $group: {
        _id: {
          sellerEmployeeCode: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] },
          currency: '$currency',
        },
        spendAmount: { $sum: '$spendAmount' },
        attributedSalesAmount: { $sum: '$attributedSalesAmount' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        attributedOrdersCount: { $sum: '$orders7d' },
      },
    },
    {
      $project: {
        _id: 0,
        sellerEmployeeCode: '$_id.sellerEmployeeCode',
        currency: '$_id.currency',
        spendAmount: 1,
        attributedSalesAmount: 1,
        impressions: 1,
        clicks: 1,
        attributedOrdersCount: 1,
      },
    },
    { $sort: { sellerEmployeeCode: 1, currency: 1 } },
  ]);
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

async function upsertByOrderItem(orderItemId, payload, { session } = {}) {
  return FinanceSnapshot.findOneAndUpdate(
    { orderItemId },
    { $set: payload },
    {
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
      ...(session ? { session } : {}),
    },
  ).lean();
}

module.exports = {
  buildFilter,
  buildFilter,
  findByOrderItem,
  findDateBounds,
  list,
  listFilterOptions,
  listByOrder,
  listByOrderItemIds,
  summarizeOrderPnl,
  summarizeBySeller,
  summarizeByTeam,
  summarizeAdsByChannel,
  summarizeAdsDaily,
  summarizeAdsBySeller,
  summarizeDaily,
  summarizeDailyProfit,
  upsertByOrderItem,
};
