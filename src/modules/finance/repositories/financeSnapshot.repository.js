const FinanceSnapshot = require('../models/financeSnapshot.model');
const AdsSpendDaily = require('../models/adsSpendDaily.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function profitabilityDateField(query = {}) {
  return query.dateBasis === 'ORDERED_AT' ? 'orderedAt' : 'calculatedAt';
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
    const dateField = profitabilityDateField(query);
    filter[dateField] = {};
    if (query.dateFrom) filter[dateField].$gte = query.dateFrom;
    if (query.dateTo) filter[dateField].$lte = query.dateTo;
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
        shops: [
          { $match: { shopId: { $ne: null } } },
          { $group: { _id: '$shopId' } },
          { $sort: { _id: 1 } },
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
    shops: (result.shops || []).map((row) => ({ id: String(row._id) })),
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
        orderIds: { $addToSet: '$orderId' },
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
        orderCount: { $size: '$orderIds' },
        revenueAmount: 1,
        knownCostAmount: '$totalCostAmount',
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

async function summarizeQuality(query = {}) {
  const dateField = profitabilityDateField(query);
  const { dateFrom, dateTo, ...scopeQuery } = query;
  const missingDateFilter = {
    ...buildFilter(scopeQuery),
    [dateField]: null,
  };
  const [qualityRows, missingDateRows] = await Promise.all([
    FinanceSnapshot.aggregate([
      { $match: buildFilter(query) },
      {
        $group: {
          _id: '$currency',
          itemCount: { $sum: 1 },
          actualCount: { $sum: { $cond: [{ $eq: ['$profitStatus', 'ACTUAL'] }, 1, 0] } },
          estimatedCount: { $sum: { $cond: [{ $eq: ['$profitStatus', 'ESTIMATED'] }, 1, 0] } },
          incompleteCostCount: { $sum: { $cond: [{ $eq: ['$profitStatus', 'INCOMPLETE_COST'] }, 1, 0] } },
          latestCalculatedAt: { $max: '$calculatedAt' },
        },
      },
      {
        $project: {
          _id: 0,
          currency: '$_id',
          itemCount: 1,
          actualCount: 1,
          estimatedCount: 1,
          incompleteCostCount: 1,
          latestCalculatedAt: 1,
        },
      },
    ]),
    FinanceSnapshot.aggregate([
      { $match: missingDateFilter },
      { $group: { _id: '$currency', missingDateCount: { $sum: 1 } } },
      { $project: { _id: 0, currency: '$_id', missingDateCount: 1 } },
    ]),
  ]);
  const rowsByCurrency = new Map(qualityRows.map((row) => [row.currency || 'USD', {
    ...row,
    currency: row.currency || 'USD',
    missingDateCount: 0,
  }]));
  missingDateRows.forEach((row) => {
    const currency = row.currency || 'USD';
    rowsByCurrency.set(currency, {
      currency,
      itemCount: 0,
      actualCount: 0,
      estimatedCount: 0,
      incompleteCostCount: 0,
      latestCalculatedAt: null,
      ...(rowsByCurrency.get(currency) || {}),
      missingDateCount: row.missingDateCount || 0,
    });
  });
  return [...rowsByCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

async function summarizeDaily(query = {}) {
  const filter = buildFilter(query);
  const dateField = `$${profitabilityDateField(query)}`;
  return FinanceSnapshot.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: dateField } },
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
          $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] },
        },
        estimatedFeeCount: { $sum: { $cond: [{ $eq: ['$feeConfidence', 'ESTIMATED'] }, 1, 0] } },
        estimatedCostCount: { $sum: { $cond: [{ $eq: ['$costBasis', 'RATE_CARD'] }, 1, 0] } },
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
        grossProfitAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$grossProfitAmount', null] },
        grossMarginBps: {
          $cond: [
            { $and: [{ $eq: ['$missingCostCount', 0] }, { $gt: ['$revenueAmount', 0] }] },
            { $round: [{ $multiply: [{ $divide: ['$grossProfitAmount', '$revenueAmount'] }, 10000] }, 0] },
            null,
          ],
        },
        missingCostCount: 1,
        estimatedFeeCount: 1,
        estimatedCostCount: 1,
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
  if (Array.isArray(query.sellerEmployeeCodes)) {
    filter.sellerEmployeeCode = { $in: [...new Set(query.sellerEmployeeCodes.filter(Boolean).map(String))] };
  } else if (query.sellerEmployeeCode) filter.sellerEmployeeCode = query.sellerEmployeeCode;
  if (Array.isArray(query.adsAccessOr)) {
    filter.$or = query.adsAccessOr.flatMap((entry) => {
      if (entry.shopId) return [{ shopId: toObjectId(entry.shopId) }];
      if (Array.isArray(entry.sellerEmployeeCodes)) {
        return [{ sellerEmployeeCode: { $in: [...new Set(entry.sellerEmployeeCodes.filter(Boolean).map(String))] } }];
      }
      return [];
    });
  }
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

async function summarizeAdsSellerDaily(query = {}) {
  return AdsSpendDaily.aggregate([
    { $match: buildAdsFilter(query) },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$reportDate' } },
          sellerEmployeeCode: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] },
          currency: '$currency',
        },
        spendAmount: { $sum: '$spendAmount' },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id.date',
        sellerEmployeeCode: '$_id.sellerEmployeeCode',
        currency: '$_id.currency',
        spendAmount: 1,
      },
    },
    { $sort: { date: 1, sellerEmployeeCode: 1, currency: 1 } },
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
      grossProfitAmount: null,
      grossMarginBps: null,
      missingCostCount: 0,
    };
    rows.set(key, { ...current, adSpendAmount: row.adSpendAmount || 0 });
  });
  return [...rows.values()]
    .map((row) => {
      const grossProfitAmount = row.grossProfitAmount;
      const netProfitAmount = grossProfitAmount === null || grossProfitAmount === undefined
        ? null
        : grossProfitAmount - (row.adSpendAmount || 0);
      return {
        ...row,
        netProfitAmount,
        netMarginBps: netProfitAmount !== null && row.revenueAmount > 0
          ? Math.round((netProfitAmount / row.revenueAmount) * 10000)
          : null,
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
      $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] },
    },
    estimatedFeeCount: {
      $sum: { $cond: [{ $eq: ['$feeConfidence', 'ESTIMATED'] }, 1, 0] },
    },
    estimatedCostCount: {
      $sum: { $cond: [{ $eq: ['$costBasis', 'RATE_CARD'] }, 1, 0] },
    },
  };
}

function marginProjection() {
  return {
    $cond: [
      { $and: [{ $eq: ['$missingCostCount', 0] }, { $gt: ['$revenueAmount', 0] }] },
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
        grossProfitAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$grossProfitAmount', null] },
        grossMarginBps: marginProjection(),
        missingCostCount: 1,
        estimatedFeeCount: 1,
        estimatedCostCount: 1,
      },
    },
    { $sort: { sellerEmployeeCode: 1, sellerName: 1 } },
  ]);
}

async function summarizeSellerDaily(query = {}) {
  const filter = buildFilter(query);
  const dateField = `$${profitabilityDateField(query)}`;
  return FinanceSnapshot.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: dateField } },
          sellerEmployeeCode: '$sellerEmployeeCode',
          sellerAccountId: '$sellerAccountId',
          sellerName: '$sellerName',
          currency: '$currency',
        },
        itemCount: { $sum: 1 },
        revenueAmount: { $sum: '$customerPaidAmount' },
        baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
        totalCostAmount: { $sum: { $ifNull: ['$totalCostAmount', 0] } },
        marketplaceFeeAmount: { $sum: { $ifNull: ['$feeAmount', 0] } },
        refundAmount: { $sum: { $ifNull: ['$refundAmount', 0] } },
        discountAmount: { $sum: { $ifNull: ['$discountAmount', 0] } },
        taxAmount: { $sum: { $ifNull: ['$taxAmount', 0] } },
        grossProfitAmount: { $sum: { $ifNull: ['$grossProfitAmount', 0] } },
        missingCostCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] } },
        estimatedFeeCount: { $sum: { $cond: [{ $eq: ['$feeConfidence', 'ESTIMATED'] }, 1, 0] } },
        estimatedCostCount: { $sum: { $cond: [{ $eq: ['$costBasis', 'RATE_CARD'] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id.date',
        sellerEmployeeCode: '$_id.sellerEmployeeCode',
        sellerAccountId: '$_id.sellerAccountId',
        sellerName: '$_id.sellerName',
        currency: '$_id.currency',
        itemCount: 1,
        revenueAmount: 1,
        baseCostAmount: 1,
        totalCostAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', null] },
        additionalFulfillmentCostAmount: {
          $cond: [
            { $eq: ['$missingCostCount', 0] },
            { $subtract: ['$totalCostAmount', '$baseCostAmount'] },
            null,
          ],
        },
        marketplaceFeeAmount: 1,
        refundAmount: 1,
        discountAmount: 1,
        taxAmount: 1,
        grossProfitAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$grossProfitAmount', null] },
        missingCostCount: 1,
        estimatedFeeCount: 1,
        estimatedCostCount: 1,
      },
    },
    { $sort: { date: 1, sellerEmployeeCode: 1, sellerName: 1, currency: 1 } },
  ]);
}

async function findDateBounds(query = {}) {
  const dateField = `$${profitabilityDateField(query)}`;
  const [bounds] = await FinanceSnapshot.aggregate([
    { $match: buildFilter(query) },
    {
      $group: {
        _id: null,
        dateFrom: { $min: dateField },
        dateTo: { $max: dateField },
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
        grossProfitAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$grossProfitAmount', null] },
        grossMarginBps: marginProjection(),
        missingCostCount: 1,
        estimatedFeeCount: 1,
        estimatedCostCount: 1,
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
  findByOrderItem,
  findDateBounds,
  list,
  listFilterOptions,
  listByOrder,
  listByOrderItemIds,
  summarizeOrderPnl,
  summarizeQuality,
  summarizeBySeller,
  summarizeSellerDaily,
  summarizeByTeam,
  summarizeAdsByChannel,
  summarizeAdsDaily,
  summarizeAdsBySeller,
  summarizeAdsSellerDaily,
  summarizeDaily,
  summarizeDailyProfit,
  upsertByOrderItem,
};
