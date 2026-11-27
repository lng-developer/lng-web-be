const FinanceSnapshot = require('../models/financeSnapshot.model');
const AdsSpendDaily = require('../models/adsSpendDaily.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

const REPORT_TIMEZONE = 'Asia/Ho_Chi_Minh';

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function toDate(value) {
  if (!value) return value;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function profitabilityDateField(query = {}) {
  return query.dateBasis === 'CALCULATED_AT' ? 'calculatedAt' : 'orderedAt';
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.currency) filter.currency = query.currency;
  if (query.orderId) filter.orderId = toObjectId(query.orderId);
  if (query.orderItemId) filter.orderItemId = toObjectId(query.orderItemId);
  if (Array.isArray(query.orderItemIds)) filter.orderItemId = { $in: query.orderItemIds.map(toObjectId) };
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (Array.isArray(query.shopIds)) filter.shopId = { $in: query.shopIds.filter(id => !query.shopId || String(id) === String(query.shopId)).map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  if (query.sellerEmployeeCode) filter.sellerEmployeeCode = query.sellerEmployeeCode;
  if (query.teamId) filter.teamId = toObjectId(query.teamId);
  if (query.departmentId) filter.departmentId = toObjectId(query.departmentId);
  if (query.sellerAccountId) filter.sellerAccountId = toObjectId(query.sellerAccountId);
  if (Array.isArray(query.accessOr)) {
    if (!query.accessOr.length) filter._id = { $exists: false };
    else
      filter.$or = query.accessOr.map((condition) =>
        Object.fromEntries(Object.entries(condition).map(([key, value]) => [key, toObjectId(value)]))
      );
  }
  if (query.snapshotStatus) filter.snapshotStatus = query.snapshotStatus;
  if (query.costStatus) filter.costStatus = query.costStatus;
  if (query.financialStatus) filter.financialStatus = query.financialStatus;
  if (query.dateFrom || query.dateTo) {
    const dateField = profitabilityDateField(query);
    filter[dateField] = {};
    if (query.dateFrom) filter[dateField].$gte = toDate(query.dateFrom);
    if (query.dateTo) filter[dateField].$lte = toDate(query.dateTo);
  }
  return filter;
}

// Read aliases keep all aggregations on the same persisted calculation version.
function canonicalStages() {
  return [{ $set: {
    estimatedFulfillmentCostAmount: { $cond: [{ $eq: ['$calculationVersion', 2] }, '$estimatedFulfillmentCostAmount', '$totalCostAmount'] },
    actualVendorTotalAmount: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$actualVendorCurrency', null] }, null] }, { $ne: ['$actualVendorCurrency', '$currency'] }] }, null, '$actualVendorTotalAmount'] },
    totalCostAmount: { $cond: [{ $eq: ['$calculationVersion', 2] }, '$effectiveFulfillmentCostAmount', { $ifNull: ['$actualVendorTotalAmount', '$totalCostAmount'] }] },
    grossProfitAmount: { $cond: [{ $eq: ['$calculationVersion', 2] }, '$profitBeforeAdsAmount', '$grossProfitAmount'] },
    baseCostAmount: { $ifNull: ['$actualVendorBaseCostAmount', '$baseCostAmount'] },
    costBasis: { $cond: [{ $eq: ['$costSource', 'ACTUAL'] }, 'VENDOR_INVOICE', '$costBasis'] },
    costLines: { $cond: [{ $eq: ['$costSource', 'ACTUAL'] }, '$costComponents', '$costLines'] },
    migrationPending: { $cond: [{ $eq: ['$calculationVersion', 2] }, 0, 1] },
  } }];
}

async function findByOrderItem(orderItemId, options) {
  return FinanceSnapshot.findOne({ orderItemId }, null, options).lean();
}

function listCalculationTimes(orderItemIds) {
  return FinanceSnapshot.find({ orderItemId: { $in: orderItemIds } }).select('orderItemId calculatedAt').lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  return FinanceSnapshot.find({ orderItemId: { $in: orderItemIds } }).lean();
}

async function listByOrder(orderId, query = {}) {
  return FinanceSnapshot.find({ ...buildFilter(query), orderId }).sort({ calculatedAt: -1, _id: -1 }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  if (query.groupBy === 'ORDER') {
    const grouped = await listOrderProfitability(query);
    const ids = grouped.items.flatMap(row => row.orderItemIds);
    const items = ids.length ? await FinanceSnapshot.find({ $and: [filter, { orderItemId: { $in: ids } }] }).sort({ orderItemId: 1 }).lean() : [];
    return { items, groupedRows: grouped.items, total: grouped.pagination.total, page, limit };
  }
  const [items, total] = await Promise.all([
    FinanceSnapshot.find(filter)
      .sort({ calculatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    FinanceSnapshot.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function listFilterOptions(query = {}) {
  const [result = {}] = await FinanceSnapshot.aggregate([
    { $match: buildFilter(query) },
    ...canonicalStages(),
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
          {
            $group: { _id: '$departmentId', name: { $first: '$departmentName' }, code: { $first: '$departmentCode' } },
          },
          { $sort: { code: 1, name: 1 } },
        ],
        shops: [{ $match: { shopId: { $ne: null } } }, { $group: { _id: '$shopId' } }, { $sort: { _id: 1 } }],
      },
    },
  ]);
  return {
    channels: (result.channels || []).map((row) => row._id),
    marketplaces: (result.marketplaces || []).map((row) => row._id),
    sellers: (result.sellers || []).map((row) => ({ employeeCode: row._id, name: row.name || null })),
    teams: (result.teams || []).map((row) => ({ id: String(row._id), name: row.name || null, code: row.code || null })),
    departments: (result.departments || []).map((row) => ({
      id: String(row._id),
      name: row.name || null,
      code: row.code || null,
    })),
    shops: (result.shops || []).map((row) => ({ id: String(row._id) })),
  };
}

async function summarizeOrderPnl(query = {}) {
  const filter = buildFilter(query);
  return FinanceSnapshot.aggregate([
    { $match: filter },
    ...canonicalStages(),
    {
      $group: {
        _id: '$currency',
        revenueAmount: { $sum: '$customerPaidAmount' },
        storedProfitAmount: { $sum: '$grossProfitAmount' },
        migrationPendingCount: { $sum: '$migrationPending' },
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
        missingCostCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] } },
        missingProfitCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$grossProfitAmount', null] }, null] }, 1, 0] } },
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
        totalCostAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', null] },
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
        profitAmount: { $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }] }, '$storedProfitAmount', null] },
        migrationPendingCount: 1,
        missingCostCount: 1,
        missingProfitCount: 1,
      },
    },
    { $sort: { currency: 1 } },
  ]);
}

async function summarizeQuality(query = {}) {
  const dateField = profitabilityDateField(query);
  const { dateFrom, dateTo, ...scopeQuery } = query;
  const missingDateFilter = { ...buildFilter(scopeQuery), [dateField]: null };
  const [qualityRows, missingDateRows] = await Promise.all([
    FinanceSnapshot.aggregate([
      { $match: buildFilter(query) },
    ...canonicalStages(),
      {
        $group: {
          _id: '$currency',
          itemCount: { $sum: 1 },
          actualCount: { $sum: { $cond: [{ $eq: ['$profitStatus', 'ACTUAL'] }, 1, 0] } },
          estimatedCount: { $sum: { $cond: [{ $eq: ['$profitStatus', 'ESTIMATED'] }, 1, 0] } },
          incompleteCostCount: { $sum: { $cond: [{ $eq: ['$profitStatus', 'INCOMPLETE_COST'] }, 1, 0] } },
          latestCalculatedAt: { $max: '$calculatedAt' },
          migrationPendingCount: { $sum: '$migrationPending' },
          allocatedFeeCount: { $sum: { $cond: [{ $eq: ['$feeConfidence', 'ALLOCATED'] }, 1, 0] } },
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
          migrationPendingCount: 1,
          allocatedFeeCount: 1,
        },
      },
    ]),
    FinanceSnapshot.aggregate([
      { $match: missingDateFilter },
      { $group: { _id: '$currency', missingDateCount: { $sum: 1 } } },
      { $project: { _id: 0, currency: '$_id', missingDateCount: 1 } },
    ]),
  ]);
  const rowsByCurrency = new Map(
    qualityRows.map((row) => [row.currency || 'USD', { ...row, currency: row.currency || 'USD', missingDateCount: 0 }])
  );
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
    ...canonicalStages(),
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: dateField, timezone: REPORT_TIMEZONE } },
          shopId: '$shopId',
          salesChannelCode: '$salesChannelCode',
          marketplaceCode: '$marketplaceCode',
          currency: '$currency',
        },
        sellerEmployeeCodes: { $addToSet: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] } },
        itemCount: { $sum: 1 },
        revenueAmount: { $sum: '$customerPaidAmount' },
        netRevenueAmount: { $sum: { $ifNull: ['$netRevenueAmount', { $subtract: ['$customerPaidAmount', { $ifNull: ['$refundAmount', 0] }] }] } },
        baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
        totalCostAmount: { $sum: { $ifNull: ['$totalCostAmount', 0] } },
        marketplaceFeeAmount: { $sum: { $ifNull: ['$feeAmount', 0] } },
        refundAmount: { $sum: { $ifNull: ['$refundAmount', 0] } },
        discountAmount: { $sum: { $ifNull: ['$discountAmount', 0] } },
        grossProfitAmount: { $sum: { $ifNull: ['$grossProfitAmount', 0] } },
        cancelledCount: { $sum: { $cond: [{ $eq: ['$financialStatus', 'CANCELLED'] }, 1, 0] } },
        partiallyRefundedCount: { $sum: { $cond: [{ $eq: ['$financialStatus', 'PARTIALLY_REFUNDED'] }, 1, 0] } },
        refundedCount: { $sum: { $cond: [{ $eq: ['$financialStatus', 'REFUNDED'] }, 1, 0] } },
        missingCostCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] } },
        missingProfitCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$grossProfitAmount', null] }, null] }, 1, 0] } },
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
        sellerEmployeeCodes: 1,
        itemCount: 1,
        revenueAmount: 1,
        netRevenueAmount: 1,
        baseCostAmount: 1,
        totalCostAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', null] },
        additionalFulfillmentCostAmount: {
          $cond: [{ $eq: ['$missingCostCount', 0] }, { $subtract: ['$totalCostAmount', '$baseCostAmount'] }, null],
        },
        marketplaceFeeAmount: 1,
        refundAmount: 1,
        discountAmount: 1,
        cancelledCount: 1,
        partiallyRefundedCount: 1,
        refundedCount: 1,
        grossProfitAmount: { $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }] }, '$grossProfitAmount', null] },
        grossMarginBps: {
          $cond: [
            { $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }, { $gt: ['$revenueAmount', 0] }] },
            { $round: [{ $multiply: [{ $divide: ['$grossProfitAmount', '$revenueAmount'] }, 10000] }, 0] },
            null,
          ],
        },
        missingCostCount: 1,
        missingProfitCount: 1,
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
  if (query.currency) filter.currency = query.currency;
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (Array.isArray(query.shopIds)) filter.shopId = { $in: query.shopIds.filter(id => !query.shopId || String(id) === String(query.shopId)).map(toObjectId) };
  if (query.salesChannelCode) filter.salesChannelCode = query.salesChannelCode;
  if (query.marketplaceCode) filter.marketplaceCode = query.marketplaceCode;
  if (query.adStatus) filter.status = query.adStatus;
  if (query.sellerAttributionSource) filter.sellerAttributionSource = query.sellerAttributionSource;
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
    if (query.dateFrom) filter.reportDate.$gte = toDate(query.dateFrom);
    if (query.dateTo) filter.reportDate.$lte = toDate(query.dateTo);
  }
  return filter;
}

async function summarizeAdsByChannel(query = {}) {
  return AdsSpendDaily.aggregate([
    { $match: buildAdsFilter(query) },
    {
      $group: {
        _id: { salesChannelCode: '$salesChannelCode', marketplaceCode: '$marketplaceCode', currency: '$currency' },
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
        _id: { sellerEmployeeCode: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] }, currency: '$currency' },
        dateKeys: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$reportDate' } } },
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
        dateKeys: 1,
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
        attributedSalesAmount: { $sum: '$attributedSalesAmount' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        attributedOrdersCount: { $sum: '$orders7d' },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id.date',
        sellerEmployeeCode: '$_id.sellerEmployeeCode',
        currency: '$_id.currency',
        spendAmount: 1,
        attributedSalesAmount: 1,
        impressions: 1,
        clicks: 1,
        attributedOrdersCount: 1,
      },
    },
    { $sort: { date: 1, sellerEmployeeCode: 1, currency: 1 } },
  ]);
}

async function listOrderProfitability(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const dateField = `$${profitabilityDateField(query)}`;
  const coverageStages =
    query.costCoverage === 'MISSING'
      ? [{ $match: { missingCostCount: { $gt: 0 } } }]
      : query.costCoverage === 'COMPLETE'
        ? [{ $match: { missingCostCount: 0 } }]
        : [];
  const [result = {}] = await FinanceSnapshot.aggregate([
    { $match: buildFilter(query) },
    ...canonicalStages(),
    {
      $group: {
        _id: {
          orderId: '$orderId',
          shopId: '$shopId',
          salesChannelCode: '$salesChannelCode',
          marketplaceCode: '$marketplaceCode',
          currency: '$currency',
        },
        orderItemIds: { $addToSet: '$orderItemId' },
        orderedAt: { $min: '$orderedAt' },
        reportDate: { $min: dateField },
        sellerEmployeeCode: { $addToSet: { $ifNull: ['$sellerEmployeeCode', null] } },
        sellerName: { $addToSet: { $ifNull: ['$sellerName', null] } },
        teamId: { $addToSet: { $ifNull: ['$teamId', null] } },
        teamName: { $addToSet: { $ifNull: ['$teamName', null] } },
        teamCode: { $addToSet: { $ifNull: ['$teamCode', null] } },
        departmentId: { $addToSet: { $ifNull: ['$departmentId', null] } },
        departmentName: { $addToSet: { $ifNull: ['$departmentName', null] } },
        departmentCode: { $addToSet: { $ifNull: ['$departmentCode', null] } },
        itemCount: { $sum: 1 },
        revenueAmount: { $sum: '$customerPaidAmount' },
        storedProfitAmount: { $sum: '$grossProfitAmount' },
        estimatedFulfillmentCostAmount: { $sum: '$estimatedFulfillmentCostAmount' },
        estimatedMissingCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$estimatedFulfillmentCostAmount', null] }, null] }, 1, 0] } },
        actualVendorTotalAmount: { $sum: '$actualVendorTotalAmount' },
        actualMissingCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$actualVendorTotalAmount', null] }, null] }, 1, 0] } },
        migrationPendingCount: { $sum: '$migrationPending' },
        netRevenueAmount: { $sum: { $ifNull: ['$netRevenueAmount', { $subtract: ['$customerPaidAmount', { $ifNull: ['$refundAmount', 0] }] }] } },
        baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
        totalCostAmount: { $sum: { $ifNull: ['$totalCostAmount', 0] } },
        lngFulfillmentFeeAmount: {
          $sum: {
            $reduce: {
              input: { $ifNull: ['$costLines', []] },
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  {
                    $cond: [
                      { $eq: ['$$this.code', 'LNG_FULFILLMENT_FEE'] },
                      { $ifNull: ['$$this.amount', 0] },
                      0,
                    ],
                  },
                ],
              },
            },
          },
        },
        shippingCostAmount: {
          $sum: {
            $reduce: {
              input: { $ifNull: ['$costLines', []] },
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  {
                    $cond: [
                      { $in: ['$$this.code', ['SHIPPING_ECONOMY', 'SHIPPING_ADDITIONAL', 'VENDOR_SHIPPING']] },
                      { $ifNull: ['$$this.amount', 0] },
                      0,
                    ],
                  },
                ],
              },
            },
          },
        },
        marketplaceFeeAmount: { $sum: { $ifNull: ['$feeAmount', 0] } },
        refundAmount: { $sum: { $ifNull: ['$refundAmount', 0] } },
        discountAmount: { $sum: { $ifNull: ['$discountAmount', 0] } },
        cancelledCount: { $sum: { $cond: [{ $eq: ['$financialStatus', 'CANCELLED'] }, 1, 0] } },
        partiallyRefundedCount: { $sum: { $cond: [{ $eq: ['$financialStatus', 'PARTIALLY_REFUNDED'] }, 1, 0] } },
        refundedCount: { $sum: { $cond: [{ $eq: ['$financialStatus', 'REFUNDED'] }, 1, 0] } },
        missingCostCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] } },
        missingProfitCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$grossProfitAmount', null] }, null] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        orderId: '$_id.orderId',
        shopId: '$_id.shopId',
        salesChannelCode: '$_id.salesChannelCode',
        marketplaceCode: '$_id.marketplaceCode',
        currency: '$_id.currency',
        orderItemIds: 1,
        orderedAt: 1,
        reportDate: 1,
        sellerEmployeeCode: { $cond: [{ $eq: [{ $size: '$sellerEmployeeCode' }, 1] }, { $arrayElemAt: ['$sellerEmployeeCode', 0] }, null] },
        sellerName: { $cond: [{ $eq: [{ $size: '$sellerName' }, 1] }, { $arrayElemAt: ['$sellerName', 0] }, null] },
        teamId: { $cond: [{ $eq: [{ $size: '$teamId' }, 1] }, { $arrayElemAt: ['$teamId', 0] }, null] },
        teamName: { $cond: [{ $eq: [{ $size: '$teamName' }, 1] }, { $arrayElemAt: ['$teamName', 0] }, null] },
        teamCode: { $cond: [{ $eq: [{ $size: '$teamCode' }, 1] }, { $arrayElemAt: ['$teamCode', 0] }, null] },
        departmentId: { $cond: [{ $eq: [{ $size: '$departmentId' }, 1] }, { $arrayElemAt: ['$departmentId', 0] }, null] },
        departmentName: { $cond: [{ $eq: [{ $size: '$departmentName' }, 1] }, { $arrayElemAt: ['$departmentName', 0] }, null] },
        departmentCode: { $cond: [{ $eq: [{ $size: '$departmentCode' }, 1] }, { $arrayElemAt: ['$departmentCode', 0] }, null] },
        itemCount: 1,
        revenueAmount: 1,
        netRevenueAmount: 1,
        baseCostAmount: 1,
        totalCostAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', null] },
        lngFulfillmentFeeAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$lngFulfillmentFeeAmount', null] },
        shippingCostAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$shippingCostAmount', null] },
        vendorAdditionalCostAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, { $subtract: ['$totalCostAmount', { $add: ['$baseCostAmount', '$lngFulfillmentFeeAmount', '$shippingCostAmount'] }] }, null] },
        marketplaceFeeAmount: 1,
        refundAmount: 1,
        discountAmount: 1,
        cancelledCount: 1,
        partiallyRefundedCount: 1,
        refundedCount: 1,
        profitAmount: { $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }] }, '$storedProfitAmount', null] },
        marginBps: { $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }, { $gt: ['$revenueAmount', 0] }] }, { $round: [{ $multiply: [{ $divide: ['$storedProfitAmount', '$revenueAmount'] }, 10000] }, 0] }, null] },
        estimatedFulfillmentCostAmount: { $cond: [{ $eq: ['$estimatedMissingCount', 0] }, '$estimatedFulfillmentCostAmount', null] },
        actualVendorTotalAmount: { $cond: [{ $eq: ['$actualMissingCount', 0] }, '$actualVendorTotalAmount', null] },
        costVarianceAmount: { $cond: [{ $and: [{ $eq: ['$estimatedMissingCount', 0] }, { $eq: ['$missingCostCount', 0] }] }, { $subtract: ['$totalCostAmount', '$estimatedFulfillmentCostAmount'] }, null] },
        costSource: { $cond: [{ $gt: ['$missingCostCount', 0] }, 'MISSING', { $cond: [{ $eq: ['$actualMissingCount', 0] }, 'ACTUAL', 'ESTIMATED'] }] },
        migrationPendingCount: 1,
        missingCostCount: 1,
        missingProfitCount: 1,
      },
    },
    {
      $facet: {
        items: [...coverageStages, { $sort: { reportDate: -1, orderId: 1, currency: 1 } }, { $skip: getPaginationOffset({ page, limit }) }, { $limit: limit }],
        total: [...coverageStages, { $count: 'count' }],
        summaryByCurrency: [
          ...coverageStages,
          {
            $group: {
              _id: '$currency',
              orderCount: { $sum: 1 },
              costedOrderCount: { $sum: { $cond: [{ $eq: ['$missingCostCount', 0] }, 1, 0] } },
              missingProfitOrderCount: { $sum: { $cond: [{ $gt: ['$missingProfitCount', 0] }, 1, 0] } },
              missingCostOrderCount: { $sum: { $cond: [{ $gt: ['$missingCostCount', 0] }, 1, 0] } },
              revenueAmount: { $sum: '$revenueAmount' },
              refundAmount: { $sum: '$refundAmount' },
              marketplaceFeeAmount: { $sum: '$marketplaceFeeAmount' },
              migrationPendingCount: { $sum: '$migrationPendingCount' },
              costedRevenueAmount: {
                $sum: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$revenueAmount', 0] },
              },
              totalCostAmount: {
                $sum: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', 0] },
              },
              profitAmount: { $sum: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$profitAmount', 0] } },
              profitableOrderCount: {
                $sum: {
                  $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $gt: ['$profitAmount', 0] }] }, 1, 0],
                },
              },
              lossOrderCount: {
                $sum: {
                  $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $lt: ['$profitAmount', 0] }] }, 1, 0],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              currency: '$_id',
              orderCount: 1,
              costedOrderCount: 1,
              missingCostOrderCount: 1,
              revenueAmount: 1,
              refundAmount: 1,
              marketplaceFeeAmount: 1,
              migrationPendingCount: 1,
              partialCostAmount: '$totalCostAmount',
              partialProfitAmount: '$profitAmount',
              totalCostAmount: { $cond: [{ $eq: ['$missingCostOrderCount', 0] }, '$totalCostAmount', null] },
              profitAmount: { $cond: [{ $and: [{ $eq: ['$missingCostOrderCount', 0] }, { $eq: ['$missingProfitOrderCount', 0] }] }, '$profitAmount', null] },
              profitableOrderCount: 1,
              lossOrderCount: 1,
              marginBps: {
                $cond: [
                  { $and: [{ $eq: ['$missingCostOrderCount', 0] }, { $eq: ['$missingProfitOrderCount', 0] }, { $gt: ['$revenueAmount', 0] }] },
                  { $round: [{ $multiply: [{ $divide: ['$profitAmount', '$costedRevenueAmount'] }, 10000] }, 0] },
                  null,
                ],
              },
            },
          },
          { $sort: { currency: 1 } },
        ],
      },
    },
  ]);
  return {
    items: result.items || [],
    pagination: { total: result.total?.[0]?.count || 0, page, limit },
    summaryByCurrency: result.summaryByCurrency || [],
  };
}

async function summarizeDailyProfit(query = {}) {
  const [financeRows, adRows] = await Promise.all([
    summarizeDaily(query),
    query.excludeAds ? Promise.resolve([]) : AdsSpendDaily.aggregate([
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
          sellerEmployeeCodes: { $addToSet: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] } },
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
          sellerEmployeeCodes: 1,
          adSpendAmount: 1,
        },
      },
    ]),
  ]);
  const rows = new Map();
  financeRows.forEach((row) => rows.set(dailyKey(row), { ...row, adSpendAmount: 0, adsCoverage: 'MISSING' }));
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
    rows.set(key, { ...current, adSpendAmount: row.adSpendAmount || 0, adsCoverage: current.sellerEmployeeCodes?.length && current.sellerEmployeeCodes.every(code => row.sellerEmployeeCodes?.includes(code)) ? 'RECORDED' : 'MISSING' });
  });
  return [...rows.values()]
    .map((row) => {
      const grossProfitAmount = row.grossProfitAmount;
      const netProfitAmount =
        grossProfitAmount === null || grossProfitAmount === undefined
          ? null
          : grossProfitAmount - (row.adSpendAmount || 0);
      return {
        ...row,
        netProfitAmount,
        profitBeforeAdsAmount: grossProfitAmount,
        profitAfterAdsAmount: row.adsCoverage === 'RECORDED' ? netProfitAmount : null,
        profitAfterOperatingCostsAmount: null,
        netMarginBps:
          netProfitAmount !== null && row.revenueAmount > 0
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
    partialGrossProfitAmount: { $sum: { $ifNull: ['$grossProfitAmount', 0] } },
    costedItemCount: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] } },
    missingCostCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] } },
        missingProfitCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$grossProfitAmount', null] }, null] }, 1, 0] } },
    estimatedFeeCount: { $sum: { $cond: [{ $eq: ['$feeConfidence', 'ESTIMATED'] }, 1, 0] } },
    estimatedCostCount: { $sum: { $cond: [{ $eq: ['$costBasis', 'RATE_CARD'] }, 1, 0] } },
  };
}

function marginProjection() {
  return {
    $cond: [
      { $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }, { $gt: ['$revenueAmount', 0] }] },
      { $round: [{ $multiply: [{ $divide: ['$grossProfitAmount', '$revenueAmount'] }, 10000] }, 0] },
      null,
    ],
  };
}

async function summarizeBySeller(query = {}) {
  const filter = buildFilter(query);
  return FinanceSnapshot.aggregate([
    { $match: filter },
    ...canonicalStages(),
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
        grossProfitAmount: { $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }] }, '$grossProfitAmount', null] },
        partialGrossProfitAmount: 1,
        costedItemCount: 1,
        grossMarginBps: marginProjection(),
        missingCostCount: 1,
        missingProfitCount: 1,
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
    ...canonicalStages(),
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: dateField, timezone: REPORT_TIMEZONE } },
          sellerEmployeeCode: '$sellerEmployeeCode',
          sellerAccountId: '$sellerAccountId',
          sellerName: '$sellerName',
          currency: '$currency',
        },
        itemCount: { $sum: 1 },
        orderIds: { $addToSet: '$orderId' },
        revenueAmount: { $sum: '$customerPaidAmount' },
        baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
        totalCostAmount: { $sum: { $ifNull: ['$totalCostAmount', 0] } },
        marketplaceFeeAmount: { $sum: { $ifNull: ['$feeAmount', 0] } },
        refundAmount: { $sum: { $ifNull: ['$refundAmount', 0] } },
        discountAmount: { $sum: { $ifNull: ['$discountAmount', 0] } },
        taxAmount: { $sum: { $ifNull: ['$taxAmount', 0] } },
        grossProfitAmount: { $sum: { $ifNull: ['$grossProfitAmount', 0] } },
        costedItemCount: {
          $sum: { $cond: [{ $ne: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] },
        },
        partialRevenueAmount: {
          $sum: {
            $cond: [
              { $ne: [{ $ifNull: ['$totalCostAmount', null] }, null] },
              { $ifNull: ['$customerPaidAmount', 0] },
              0,
            ],
          },
        },
        partialGrossProfitAmount: {
          $sum: {
            $cond: [
              { $ne: [{ $ifNull: ['$totalCostAmount', null] }, null] },
              { $ifNull: ['$grossProfitAmount', 0] },
              0,
            ],
          },
        },
        missingCostCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] }, 1, 0] } },
        missingProfitCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$grossProfitAmount', null] }, null] }, 1, 0] } },
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
        orderCount: { $size: '$orderIds' },
        orderIds: 1,
        revenueAmount: 1,
        baseCostAmount: 1,
        totalCostAmount: { $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', null] },
        additionalFulfillmentCostAmount: {
          $cond: [{ $eq: ['$missingCostCount', 0] }, { $subtract: ['$totalCostAmount', '$baseCostAmount'] }, null],
        },
        marketplaceFeeAmount: 1,
        refundAmount: 1,
        discountAmount: 1,
        taxAmount: 1,
        grossProfitAmount: { $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }] }, '$grossProfitAmount', null] },
        costedItemCount: 1,
        partialRevenueAmount: 1,
        partialGrossProfitAmount: 1,
        missingCostCount: 1,
        missingProfitCount: 1,
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
    ...canonicalStages(),
    { $group: { _id: null, dateFrom: { $min: dateField }, dateTo: { $max: dateField } } },
    { $project: { _id: 0, dateFrom: 1, dateTo: 1 } },
  ]);
  return bounds || null;
}

async function summarizeByTeam(query = {}) {
  const filter = buildFilter(query);
  return FinanceSnapshot.aggregate([
    { $match: filter },
    ...canonicalStages(),
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
        sellerEmployeeCodes: { $addToSet: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] } },
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
        sellerEmployeeCodes: 1,
        activeSellerCount: { $size: '$sellerEmployeeCodes' },
        itemCount: 1,
        revenueAmount: 1,
        baseCostAmount: 1,
        grossProfitAmount: { $cond: [{ $and: [{ $eq: ['$missingCostCount', 0] }, { $eq: ['$missingProfitCount', 0] }] }, '$grossProfitAmount', null] },
        grossMarginBps: marginProjection(),
        missingCostCount: 1,
        missingProfitCount: 1,
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
    }
  ).lean();
}

async function updateActualVendorCost(orderItemId, payload, options) {
  return FinanceSnapshot.findOneAndUpdate(
    { orderItemId },
    { $set: payload },
    { returnDocument: 'after', runValidators: true, ...options },
  ).lean();
}

module.exports = {
  scanCanonicalScope,
  compareAndSetCanonical,
  buildFilter,
  findByOrderItem,
  findDateBounds,
  list,
  listFilterOptions,
  listByOrder,
  listByOrderItemIds,
  listCalculationTimes,
  summarizeOrderPnl,
  summarizeQuality,
  summarizeBySeller,
  summarizeSellerDaily,
  summarizeByTeam,
  summarizeAdsByChannel,
  summarizeAdsDaily,
  summarizeAdsBySeller,
  summarizeAdsSellerDaily,
  listOrderProfitability,
  summarizeDaily,
  summarizeDailyProfit,
  upsertByOrderItem,
  updateActualVendorCost,
};

function scanCanonicalScope({ sellerEmployeeCode, from, until }) {
  return FinanceSnapshot.find({ sellerEmployeeCode, orderedAt: { $gte: from, $lt: until } }).sort({ _id: 1 }).lean().cursor();
}

function compareAndSetCanonical(id, revision, patch, options = {}) {
  return FinanceSnapshot.updateOne({ _id: id, updatedAt: revision ? new Date(revision) : null },
    { $set: patch }, { ...options, runValidators: true, timestamps: false });
}
