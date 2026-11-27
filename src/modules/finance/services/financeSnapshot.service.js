const { calculateSnapshotFinancials, readSnapshotFinancials, vendorCostFields } = require('./financeCalculation.service');
const AppError = require('../../../shared/errors/appError');
const mongoose = require('mongoose');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const hrPublic = require('../../hr/public');
const mappingPublic = require('../../mapping/public');
const orderPublic = require('../../order/public');
const organizationPublic = require('../../organization/public');
const shipmentPublic = require('../../shipment/public');
const auditPublic = require('../../audit/public');
const crypto = require('crypto');
const {
  financeCostStatuses,
  financeCostBases,
  financeFeeConfidences,
  financePermissions,
  financeProfitStatuses,
  financeSnapshotStatuses,
  marketplaceFeeSources,
  MARKETPLACE_FEE_ESTIMATE_BPS,
} = require('../constants/finance.constants');
const repository = require('../repositories/financeSnapshot.repository');
const financeImportRepository = require('../repositories/financeImport.repository');
const financeAccess = require('./financeAccess.service');
const { toFinanceSnapshotDto, toOrderFinanceSummaryDto, toPaginatedResponse, toOrderFinanceRowDto } = require('../dtos/financeSnapshot.dto');

const { isDeepStrictEqual } = require('node:util');
const requests = require('../repositories/financeRecalculationRequest.repository');

async function withOrderGuard(orderId, work) {
  await requests.prepareGuard(orderId);
  return withFinanceTransaction(async (session) => {
    await requests.lockOrder(orderId, session);
    return work(session);
  });
}

const SHOP_SCOPE_TYPE = 'shop';

async function recordRecalculationAudit(
  { action, entityType, entityId, shopId, metadata, operationId },
  authContext,
  httpContext,
  session,
) {
  const actorAccountId = authContext?.accountId || null;
  await auditPublic.record(
    {
      actorType: actorAccountId ? 'ACCOUNT' : 'SYSTEM',
      actorAccountId,
      actorSnapshot: {},
      action,
      entityType,
      entityId: String(entityId),
      scopeType: shopId ? 'SHOP' : null,
      scopeId: shopId ? String(shopId) : null,
      outcome: 'SUCCEEDED',
      source: httpContext ? 'HTTP' : 'SYSTEM',
      requestId: httpContext?.requestId ? String(httpContext.requestId).slice(0, 200) : null,
      ipAddress: httpContext?.ipAddress || null,
      userAgent: httpContext?.userAgent || null,
      changes: null,
      metadata,
      deduplicationKey: [
        'finance-recalculation',
        action.toLowerCase(),
        entityType.toLowerCase(),
        entityId,
        operationId,
      ].join(':'),
    },
    { session },
  );
}

function recalculationOperationId() {
  return crypto.randomUUID();
}

async function withFinanceTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasPermission(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return (
    permissions.includes(permission) ||
    (permission === financePermissions.READ && permissions.includes(financePermissions.WRITE))
  );
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasPermission(authContext, permission)) return;
  const scope = { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId };
  const canAccess =
    authPublic.canAccessScope(authContext, permission, scope) ||
    (permission === financePermissions.READ && authPublic.canAccessScope(authContext, financePermissions.WRITE, scope));
  if (!canAccess) {
    throw forbidden();
  }
}

function getScopedReadableShopIds(authContext = {}) {
  return [
    ...new Set(
      (authContext.scopes || [])
        .filter(
          (scope) =>
            scope.scopeType === SHOP_SCOPE_TYPE &&
            scope.scopeId &&
            ((scope.permissions || []).includes(financePermissions.READ) ||
              (scope.permissions || []).includes(financePermissions.WRITE)),
        )
        .map((scope) => String(scope.scopeId)),
    ),
  ];
}

function scopedReadQuery(query = {}, authContext) {
  return financeAccess.scopedQuery(query, authContext, financePermissions.READ);
}

function moneyAmount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function nullableMoneyAmount(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function calculateRevenue(item = {}, financeTotals = {}) {
  const price = item.price || {};
  const itemPriceAmount = moneyAmount(price.itemPriceAmount);
  const taxAmount =
    moneyAmount(price.itemTaxAmount) + moneyAmount(price.shippingTaxAmount) + moneyAmount(price.giftWrapTaxAmount);
  const shippingAmount = moneyAmount(price.shippingPriceAmount);
  const giftWrapAmount = moneyAmount(price.giftWrapPriceAmount);
  const discountAmount =
    moneyAmount(price.itemPromotionDiscountAmount) + moneyAmount(price.shipPromotionDiscountAmount);
  const customerPaidAmount = itemPriceAmount + shippingAmount;
  const importedFeeAmount = item.finance?.feeAmount ?? item.externalData?.finance?.feeAmount;
  const hasSettlementFee = financeTotals.feeAmount !== null && financeTotals.feeAmount !== undefined;
  const hasImportedFee = importedFeeAmount !== null && importedFeeAmount !== undefined;
  const feeAmount = hasSettlementFee
    ? moneyAmount(financeTotals.feeAmount)
    : hasImportedFee
      ? moneyAmount(importedFeeAmount)
      : Math.round((customerPaidAmount * MARKETPLACE_FEE_ESTIMATE_BPS) / 10000);
  const feeSource = hasSettlementFee
    ? marketplaceFeeSources.SETTLEMENT
    : hasImportedFee
      ? marketplaceFeeSources.ORDER_IMPORT
      : marketplaceFeeSources.ESTIMATED_15_PERCENT;
  const feeConfidence = financeTotals.hasAllocatedFees
    ? financeFeeConfidences.ALLOCATED
    : feeSource === marketplaceFeeSources.ESTIMATED_15_PERCENT
      ? financeFeeConfidences.ESTIMATED
      : financeFeeConfidences.ACTUAL;
  const refundAmount =
    financeTotals.refundAmount !== null && financeTotals.refundAmount !== undefined
      ? moneyAmount(financeTotals.refundAmount)
      : moneyAmount(item.finance?.refundAmount || item.externalData?.finance?.refundAmount);
  const externalStatus = String(item.externalStatus || '').toUpperCase();
  const itemStatus = String(item.status || '').toUpperCase();
  const isMarketplaceCancelled =
    ['CANCELLED', 'CANCELED', 'PARTIALLY_CANCELLED'].includes(externalStatus) ||
    ['CANCELLED', 'CANCELED', 'PARTIALLY_CANCELLED'].includes(itemStatus);
  const financialStatus = isMarketplaceCancelled
    ? 'CANCELLED'
    : refundAmount <= 0
      ? 'ACTIVE'
      : refundAmount >= customerPaidAmount
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';
  return {
    itemPriceAmount,
    taxAmount,
    shippingAmount,
    giftWrapAmount,
    discountAmount,
    feeAmount: isMarketplaceCancelled && feeSource === marketplaceFeeSources.ESTIMATED_15_PERCENT ? 0 : feeAmount,
    feeSource,
    feeConfidence,
    refundAmount,
    customerPaidAmount,
    netRevenueAmount: isMarketplaceCancelled
      ? 0
      : Math.max(customerPaidAmount - refundAmount, 0),
    orderItemStatus: item.status || null,
    financialStatus,
    currency: price.currency || 'USD',
  };
}

function getCostLineAmount(costEstimate, code) {
  const line = (costEstimate?.lines || []).find((entry) => entry.code === code);
  return line ? nullableMoneyAmount(line.amount) : null;
}

function calculateCost(fulfillmentPlan, isCancelled = false) {
  if (isCancelled) {
    return {
      baseCostAmount: 0,
      totalCostAmount: 0,
      costLines: [],
      costStatus: financeCostStatuses.PRESENT,
      costBasis: financeCostBases.RATE_CARD,
      snapshotStatus: financeSnapshotStatuses.ESTIMATED,
      missingCostReason: null,
    };
  }

  const costEstimate = fulfillmentPlan?.costEstimate || null;
  if (!costEstimate) {
    return {
      baseCostAmount: null,
      totalCostAmount: null,
      costLines: [],
      costStatus: financeCostStatuses.MISSING,
      costBasis: financeCostBases.MISSING,
      snapshotStatus: financeSnapshotStatuses.MISSING_COST,
      missingCostReason: fulfillmentPlan ? 'COST_ESTIMATE_NOT_AVAILABLE' : 'FULFILLMENT_PLAN_NOT_FOUND',
    };
  }

  const baseCostAmount = getCostLineAmount(costEstimate, 'BASE_COST');
  const totalCostAmount = nullableMoneyAmount(costEstimate.totalAmount);
  if (baseCostAmount === null || totalCostAmount === null) {
    return {
      baseCostAmount,
      totalCostAmount,
      costLines: (costEstimate.lines || []).map((line) => ({
        code: line.code,
        currency: costEstimate.currency || null,
        label: line.label || null,
        amount: moneyAmount(line.amount),
      })),
      costStatus: financeCostStatuses.MISSING,
      costBasis: financeCostBases.MISSING,
      snapshotStatus: financeSnapshotStatuses.MISSING_COST,
      missingCostReason: baseCostAmount === null ? 'BASE_COST_NOT_AVAILABLE' : 'TOTAL_COST_NOT_AVAILABLE',
    };
  }

  return {
    baseCostAmount,
    totalCostAmount,
    costLines: (costEstimate.lines || []).map((line) => ({
      code: line.code,
      currency: costEstimate.currency || null,
      label: line.label || null,
      amount: moneyAmount(line.amount),
    })),
    costStatus: financeCostStatuses.PRESENT,
    costBasis: financeCostBases.RATE_CARD,
    snapshotStatus: financeSnapshotStatuses.ESTIMATED,
    missingCostReason: null,
  };
}

function profitStatusFor({ costStatus, costBasis, feeConfidence, actualVendorTotalAmount, isCancelled = false }) {
  if (costStatus !== financeCostStatuses.PRESENT) return financeProfitStatuses.INCOMPLETE_COST;
  if (isCancelled) {
    return feeConfidence === financeFeeConfidences.ACTUAL
      ? financeProfitStatuses.ACTUAL
      : financeProfitStatuses.ESTIMATED;
  }
  if (actualVendorTotalAmount !== null && actualVendorTotalAmount !== undefined) {
    return financeProfitStatuses.ACTUAL;
  }
  if (costBasis !== financeCostBases.VENDOR_INVOICE || feeConfidence !== financeFeeConfidences.ACTUAL) {
    return financeProfitStatuses.ESTIMATED;
  }
  return financeProfitStatuses.ACTUAL;
}

function calculateMargin({ customerPaidAmount, netRevenueAmount, feeAmount, refundAmount, discountAmount }, totalCostAmount, costStatus) {
  if (totalCostAmount === null || totalCostAmount === undefined || costStatus !== financeCostStatuses.PRESENT) {
    return { grossProfitAmount: null, grossMarginBps: null };
  }
  const grossProfitAmount = (netRevenueAmount ?? customerPaidAmount) - feeAmount - totalCostAmount - discountAmount;
  return {
    grossProfitAmount,
    grossMarginBps: customerPaidAmount > 0 ? Math.round((grossProfitAmount / customerPaidAmount) * 10000) : null,
  };
}

function calculateOrderPnl(snapshot = {}) {
  const canonical = snapshot.calculationVersion === 2 || snapshot.grossProfitAmount != null
    ? readSnapshotFinancials(snapshot) : calculateSnapshotFinancials(snapshot);
  const totalCostAmount = canonical.effectiveFulfillmentCostAmount;
  const baseCostAmount = totalCostAmount === null ? null
    : snapshot.actualVendorTotalAmount != null ? (snapshot.actualVendorBaseCostAmount ?? 0) : (snapshot.baseCostAmount ?? 0);
  return {
    marketplaceFeeAmount: moneyAmount(snapshot.feeAmount),
    refundAmount: moneyAmount(snapshot.refundAmount),
    discountAmount: snapshot.financialStatus === 'CANCELLED' ? 0 : moneyAmount(snapshot.discountAmount),
    baseCostAmount,
    additionalFulfillmentCostAmount: totalCostAmount === null ? null : totalCostAmount - baseCostAmount,
    totalCostAmount,
    totalDeductionAmount: totalCostAmount === null ? null
      : moneyAmount(snapshot.customerPaidAmount) - canonical.recognizedNetRevenueAmount + moneyAmount(snapshot.feeAmount) + totalCostAmount,
    profitAmount: canonical.profitBeforeAdsAmount,
  };
}

async function loadOrderItem(orderItemId) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  if (item.orderedAt) return item;
  const order = await orderPublic.findById(item.orderId);
  return { ...item, orderedAt: order?.orderedAt || null };
}

function resolveOrderItemImageUrl(item = {}, listing = null) {
  return listing?.productImageUrl
    || item?.listingImage?.sourceUrl
    || item?.externalData?.etsy?.listingImageUrl
    || item?.externalData?.etsy?.listingImageThumbnailUrl
    || item?.externalData?.productImageUrl
    || item?.externalData?.imageUrl
    || null;
}

async function listSnapshots(query = {}, authContext) {
  const { externalOrderId, ...snapshotQuery } = query;
  let orderItemIds = null;
  if (externalOrderId) {
    orderItemIds = (await orderPublic.findItemIds({ externalOrderId })).map(String);
  }
  const resolvedSnapshotQuery = scopedReadQuery(
    orderItemIds === null ? snapshotQuery : { ...snapshotQuery, orderItemIds },
    authContext,
  );
  const [result, summaryByCurrency, missing] = await Promise.all([
    repository.list(resolvedSnapshotQuery),
    repository.summarizeOrderPnl(resolvedSnapshotQuery),
    missingSnapshotItems(resolvedSnapshotQuery),
  ]);
  if (authContext) {
    result.items.forEach((snapshot) =>
      financeAccess.assertSnapshotAccess(snapshot, authContext, financePermissions.READ),
    );
  }
  const orderItems = await orderPublic.findItemsByIds(result.items.map((snapshot) => String(snapshot.orderItemId)));
  const externalOrderIds = new Map(
    orderItems.map((item) => [String(item._id || item.id), item.externalOrderId || null]),
  );
  const listingIds = [...new Set(orderItems.map((i) => i.listingId).filter(Boolean).map(String))];
  const listings = listingIds.length ? await catalogPublic.getListingSummariesByIds(listingIds) : [];
  const listingById = new Map(listings.map((l) => [String(l._id || l.id), l]));
  const itemById = new Map(orderItems.map((item) => [String(item._id || item.id), item]));
  const response = {
    ...toPaginatedResponse({
      ...result,
      items: result.items.map((snapshot) => {
        const item = itemById.get(String(snapshot.orderItemId));
        const listing = item?.listingId ? listingById.get(String(item.listingId)) : null;
        return {
          ...snapshot,
          externalOrderId: externalOrderIds.get(String(snapshot.orderItemId)) || null,
          productImageUrl: resolveOrderItemImageUrl(item, listing),
          productTitle: item?.title || listing?.title || null,
          productSku: item?.sku || listing?.sku || null,
          orderPnl: calculateOrderPnl(snapshot),
        };
      }),
    }),
    summaryByCurrency: applyMissingCoverage(summaryByCurrency || [], missing),
    missingSnapshotCount: missing.length,
  };
  if (result.groupedRows) response.items = applyMissingCoverage(result.groupedRows, missing, ['orderId', 'currency'], false).map(row => toOrderFinanceRowDto(row,
    response.items.filter(item => item.orderId === String(row.orderId) && item.revenue.currency === row.currency))).filter(Boolean);
  return response;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

async function exportSnapshotsCsv(query = {}, authContext) {
  const items = [];
  let page = 1;
  let total;
  do {
    const result = await listSnapshots({ ...query, groupBy: 'ITEM', page, limit: 100 }, authContext);
    items.push(...result.items);
    total = result.pagination.total;
    if (!result.items.length) break;
    page += 1;
  } while (items.length < total);
  return csvRows([
    [
      'Order ID',
      'Order item ID',
      'Channel',
      'Marketplace',
      'Seller',
      'Team',
      'Currency',
      'Customer paid (minor)',
      'Marketplace fees (minor)',
      'Refund (minor)',
      'Discount (minor)',
      'Base cost (minor)',
      'Total cost (minor)',
      'Profit (minor)',
      'Margin bps',
      'Cost status',
      'Snapshot status',
      'Missing cost reason',
      'Calculated at',
    ],
    ...items.map((snapshot) => [
      snapshot.externalOrderId || snapshot.orderId,
      snapshot.orderItemId,
      snapshot.salesChannelCode,
      snapshot.marketplaceCode,
      snapshot.seller?.employeeCode || snapshot.seller?.name,
      snapshot.team?.name || snapshot.team?.code,
      snapshot.revenue?.currency,
      snapshot.revenue?.customerPaidAmount,
      snapshot.orderPnl?.marketplaceFeeAmount ?? snapshot.revenue?.feeAmount,
      snapshot.orderPnl?.refundAmount ?? snapshot.revenue?.refundAmount,
      snapshot.orderPnl?.discountAmount ?? snapshot.revenue?.discountAmount,
      snapshot.cost?.baseCostAmount,
      snapshot.cost?.totalCostAmount,
      snapshot.orderPnl?.profitAmount ?? snapshot.margin?.grossProfitAmount,
      snapshot.margin?.grossMarginBps,
      snapshot.cost?.costStatus,
      snapshot.snapshotStatus,
      snapshot.cost?.missingCostReason,
      snapshot.calculatedAt,
    ]),
  ]);
}

async function listFilterOptions(authContext) {
  return repository.listFilterOptions(scopedReadQuery({}, authContext));
}

async function listFilterOptionsByQuery(query = {}) {
  return repository.listFilterOptions(query);
}

async function getSnapshotByOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const snapshot = await repository.findByOrderItem(orderItemId);
  if (!snapshot) return null;
  financeAccess.assertSnapshotAccess(snapshot, authContext, financePermissions.READ);
  const sourceReferences = await financeImportRepository.listSourceReferencesByOrderItem(orderItemId);
  return toFinanceSnapshotDto({ ...snapshot, sourceReferences, orderPnl: calculateOrderPnl(snapshot) });
}

async function listSnapshotsByOrderItemIds(orderItemIds = [], authContext) {
  const uniqueIds = [...new Set(orderItemIds.map(String).filter(Boolean))];
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  const snapshots = await repository.listByOrderItemIds(uniqueIds);
  if (authContext) {
    snapshots.forEach((snapshot) => financeAccess.assertSnapshotAccess(snapshot, authContext, financePermissions.READ));
  }
  return snapshots.map((snapshot) => toFinanceSnapshotDto({ ...snapshot, orderPnl: calculateOrderPnl(snapshot) }));
}

function parseSellerEmployeeCode(sku) {
  const [employeeCode] = String(sku || '')
    .trim()
    .split('-');
  return employeeCode ? employeeCode.toUpperCase() : null;
}

async function resolveSellerDimensions(item = {}) {
  const sellerEmployeeCode = parseSellerEmployeeCode(item.sku);
  const dimensions = {
    sellerEmployeeCode,
    sellerAccountId: null,
    sellerName: null,
    teamId: null,
    teamName: null,
    teamCode: null,
    departmentId: null,
    departmentName: null,
    departmentCode: null,
  };

  if (!sellerEmployeeCode) return dimensions;

  const profile = await hrPublic.getEmployeeProfileByEmployeeCode(sellerEmployeeCode);
  if (!profile?.accountId) return dimensions;

  const [organization] = await organizationPublic.listAccountOrganizationSummaries([String(profile.accountId)]);
  return {
    ...dimensions,
    sellerAccountId: profile.accountId,
    sellerName: profile.fullName || null,
    teamId: organization?.team?.id || null,
    teamName: organization?.team?.name || null,
    teamCode: organization?.team?.code || null,
    departmentId: organization?.department?.id || null,
    departmentName: organization?.department?.name || null,
    departmentCode: organization?.department?.code || null,
  };
}

async function missingSnapshotItems(query = {}) {
  // Items without a calculation have no CALCULATED_AT membership.
  if (query.dateBasis === 'CALCULATED_AT') return [];
  const missing = [];
  const dimensions = new Map();
  let after;
  for (;;) {
    const items = await orderPublic.pageFinanceItems(query, after, 500);
    if (!items.length) break;
    const existing = new Set((await repository.listCalculationTimes(items.map(item => item._id))).map(row => String(row.orderItemId)));
    for (const item of items) {
      if (existing.has(String(item._id))) continue;
      const code = parseSellerEmployeeCode(item.sku);
      if (!dimensions.has(code)) dimensions.set(code, await resolveSellerDimensions(item));
      const row = { ...item, ...dimensions.get(code), date: item.orderedAt ? reportDateKey(item.orderedAt) : null };
      if (['sellerAccountId', 'teamId', 'departmentId'].some(key => query[key] && String(row[key]) !== String(query[key]))) continue;
      if (Array.isArray(query.accessOr) && !query.accessOr.some(condition => Object.entries(condition).every(([key, value]) => String(row[key]) === String(value)))) continue;
      missing.push(row);
    }
    if (items.length < 500) break;
    after = items.at(-1)._id;
  }
  return missing;
}

function applyMissingCoverage(rows, missing, keys = ['currency'], includeMissingGroups = true) {
  const keyOf = row => keys.map(key => String(row[key] ?? '')).join('|');
  const groups = new Map(rows.map(row => [keyOf(row), { ...row, missingSnapshotCount: 0 }]));
  for (const item of missing) {
    const key = keyOf(item);
    if (!groups.has(key) && !includeMissingGroups) continue;
    const row = groups.get(key) || { ...Object.fromEntries(keys.map(field => [field, item[field]])), itemCount: 0, missingCostCount: 0 };
    row.missingSnapshotCount = (row.missingSnapshotCount || 0) + 1;
    row.missingCostCount = (row.missingCostCount || 0) + 1;
    row.itemCount = (row.itemCount || 0) + 1;
    for (const field of ['totalCostAmount', 'effectiveFulfillmentCostAmount', 'profitAmount', 'grossProfitAmount', 'netProfitAmount', 'profitBeforeAdsAmount', 'profitAfterAdsAmount', 'profitAfterOperatingCostsAmount', 'marginBps', 'grossMarginBps', 'netMarginBps', 'costVarianceAmount', 'additionalFulfillmentCostAmount', 'totalDeductionAmount']) row[field] = null;
    groups.set(key, row);
  }
  return [...groups.values()];
}

async function summarizeWithCoverage(method, query, keys) {
  const [rows, missing] = await Promise.all([repository[method](query), missingSnapshotItems(query)]);
  return applyMissingCoverage(rows, missing, keys);
}

async function summarizeDaily(query = {}) {
  return summarizeWithCoverage('summarizeDaily', query, ['date', 'shopId', 'salesChannelCode', 'marketplaceCode', 'currency']);
}

async function summarizeQuality(query = {}) {
  return summarizeWithCoverage('summarizeQuality', query, ['currency']);
}

async function summarizeDailyProfit(query = {}) {
  return summarizeWithCoverage('summarizeDailyProfit', query, ['date', 'shopId', 'salesChannelCode', 'marketplaceCode', 'currency']);
}

async function listOrderProfitability(query = {}) {
  const [result, missing] = await Promise.all([repository.listOrderProfitability(query), missingSnapshotItems(query)]);
  result.items = applyMissingCoverage(result.items, missing, ['orderId', 'currency'], false);
  result.summaryByCurrency = applyMissingCoverage(result.summaryByCurrency || [], missing);
  const orderItemIds = result.items.flatMap((row) => (row.orderItemIds || []).map(String));
  const orderItems = await orderPublic.findItemsByIds(orderItemIds);
  const listingIds = [...new Set(orderItems.map((i) => i.listingId).filter(Boolean).map(String))];
  const listings = listingIds.length ? await catalogPublic.getListingSummariesByIds(listingIds) : [];
  const listingById = new Map(listings.map((l) => [String(l._id || l.id), l]));
  const itemById = new Map(orderItems.map((item) => [String(item._id || item.id), item]));
  const externalOrderIdByItemId = new Map(
    orderItems.map((item) => [String(item._id || item.id), item.externalOrderId || null]),
  );
  const items = result.items.map(({ orderItemIds, orderId, shopId, ...row }) => {
    const thumbnails = (orderItemIds || []).map((id) => {
      const item = itemById.get(String(id));
      if (!item) return null;
      const listing = item.listingId ? listingById.get(String(item.listingId)) : null;
      return {
        orderItemId: String(item._id || item.id),
        title: item.title || listing?.title || null,
        sku: item.sku || listing?.sku || null,
        asin: item.asin || listing?.asin || null,
        quantity: item.quantity || 1,
        imageUrl: resolveOrderItemImageUrl(item, listing),
      };
    }).filter(Boolean);

    return {
      ...row,
      orderId: String(orderId),
      shopId: String(shopId),
      externalOrderId: externalOrderIdByItemId.get(String(orderItemIds?.[0])) || null,
      productImageUrl: thumbnails[0]?.imageUrl || null,
      productTitle: thumbnails[0]?.title || null,
      productSku: thumbnails[0]?.sku || null,
      itemThumbnails: thumbnails,

    };
  });
  return { ...result, items };
}

async function summarizeAdsByChannel(query = {}) {
  return repository.summarizeAdsByChannel(query);
}

async function summarizeAdsDaily(query = {}) {
  return repository.summarizeAdsDaily(query);
}

async function summarizeAdsBySeller(query = {}) {
  return repository.summarizeAdsBySeller(query);
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reportDateKey(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}

function countDays(dateFrom, dateTo) {
  const start = toDate(dateFrom);
  const end = toDate(dateTo);
  if (!start || !end || end < start) return 0;
  const startUtc = new Date(reportDateKey(start)).getTime();
  const endUtc = new Date(reportDateKey(end)).getTime();
  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}

function applyOperatingCost(row, operatingCostAmount, extra = {}) {
  const revenueAmount = moneyAmount(row.revenueAmount);
  const grossProfitAmount = nullableMoneyAmount(row.grossProfitAmount);
  const netProfitAmount = grossProfitAmount === null ? null : grossProfitAmount - operatingCostAmount;
  const partialGrossProfitAmount = nullableMoneyAmount(row.partialGrossProfitAmount);
  const partialOperatingCostAmount =
    partialGrossProfitAmount === null || revenueAmount === 0
      ? null
      : Math.round((operatingCostAmount * moneyAmount(row.partialRevenueAmount)) / revenueAmount);
  const partialNetProfitAmount =
    partialGrossProfitAmount === null ? null : partialGrossProfitAmount - (partialOperatingCostAmount || 0);
  return {
    ...row,
    ...extra,
    operatingCostAmount,
    netProfitAmount,
    netMarginBps:
      netProfitAmount !== null && revenueAmount > 0 ? Math.round((netProfitAmount / revenueAmount) * 10000) : null,
    ...(partialNetProfitAmount === null ? {} : { partialNetProfitAmount }),
  };
}

async function summarizeBySeller(query = {}) {
  const [rows, reportDates] = await Promise.all([summarizeWithCoverage('summarizeBySeller', query, ['sellerEmployeeCode', 'currency']), getReportDateKeys(query)]);
  const operatingCosts = await resolveOperatingCosts(
    rows.flatMap((row) => reportDates.map((date) => ({ sellerAccountId: row.sellerAccountId, date }))),
  );
  return rows
    .map((row) =>
      applyOperatingCost(
        row,
        reportDates.reduce((total, date) => total + (operatingCosts.get(`${row.sellerAccountId}|${date}`) || 0), 0),
        {
          operatingCostDays: reportDates.filter((date) => operatingCosts.has(`${row.sellerAccountId}|${date}`)).length,
          operatingCostCoverage: reportDates.length && reportDates.every(date => operatingCosts.has(`${row.sellerAccountId}|${date}`)) ? 'RECORDED' : 'MISSING',
        },
      ),
    )
    .sort((left, right) => String(left.sellerEmployeeCode || '').localeCompare(String(right.sellerEmployeeCode || '')));
}

async function resolveOperatingCosts(rows = []) {
  const accountIds = [
    ...new Set(
      rows
        .map((row) => row.sellerAccountId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  if (!accountIds.length) return new Map();
  const accounts = await authPublic.listOperatingCostAccounts(accountIds);
  const byId = new Map(accounts.map((account) => [String(account._id), account]));
  return new Map(
    rows.flatMap((row) => {
      const account = byId.get(String(row.sellerAccountId));
      const start = account?.operatingCostStartedAt || account?.createdAt;
      const end = account?.deactivatedAt;
      const applies =
        account &&
        Number(account.operatingCostAmount) > 0 &&
        start && row.date >= reportDateKey(start) &&
        (!end || row.date <= reportDateKey(end));
      return account ? [[`${row.sellerAccountId}|${row.date}`, applies ? Number(account.operatingCostAmount) : 0]] : [];
    }),
  );
}

async function getReportDays(query = {}) {
  return (await getReportDateKeys(query)).length;
}

async function getReportDateKeys(query = {}) {
  const bounds = query.dateFrom && query.dateTo ? null : await repository.findDateBounds(query);
  const start = toDate(query.dateFrom || bounds?.dateFrom);
  const days = countDays(start, query.dateTo || bounds?.dateTo);
  if (!start || !days) return [];
  const firstDay = new Date(reportDateKey(start));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(firstDay.getTime() + index * 86400000);
    return date.toISOString().slice(0, 10);
  });
}

async function summarizeSellerDaily(query = {}) {
  const rows = await summarizeWithCoverage('summarizeSellerDaily', query, ['date', 'sellerEmployeeCode', 'currency']);
  const operatingCosts = await resolveOperatingCosts(rows);
  return rows.map((row) => {
    const operatingCostAmount = operatingCosts.get(`${row.sellerAccountId}|${row.date}`) || 0;
    return applyOperatingCost(row, operatingCostAmount, { operatingCostDays: operatingCostAmount ? 1 : 0,
      operatingCostCoverage: operatingCosts.has(`${row.sellerAccountId}|${row.date}`) ? 'RECORDED' : 'MISSING' });
  });
}

async function summarizeAdsSellerDaily(query = {}) {
  return repository.summarizeAdsSellerDaily(query);
}

async function summarizeByTeam(query = {}) {
  const rows = await summarizeWithCoverage('summarizeByTeam', query, ['teamId', 'currency']);
  return rows
    .map((row) => applyOperatingCost(row, 0, { activeSellerCount: row.activeSellerCount, operatingCostDays: 0, operatingCostCoverage: 'MISSING' }))
    .sort((left, right) => String(left.teamCode || '').localeCompare(String(right.teamCode || '')));
}

async function buildSnapshotPayload(orderItemId, authContext) {
  const item = await loadOrderItem(orderItemId);
  const [existingSnapshot, sellerDimensions] = await Promise.all([
    repository.findByOrderItem(orderItemId),
    resolveSellerDimensions(item),
  ]);
  financeAccess.assertSnapshotAccess(
    existingSnapshot || { shopId: item.shopId, ...sellerDimensions },
    authContext,
    financePermissions.WRITE,
  );

  const [fulfillmentPlan, shipment] = await Promise.all([
    mappingPublic.getFulfillmentPlanForOrderItem(orderItemId),
    shipmentPublic.getShipmentByOrderItem(orderItemId),
  ]);
  const [feeAmount, refundAmount, hasAllocatedFees] = await Promise.all([
    financeImportRepository.sumFeesByOrderItem(orderItemId),
    financeImportRepository.sumRefundsByOrderItem(orderItemId),
    financeImportRepository.hasAllocatedFeesByOrderItem(orderItemId),
  ]);
  const revenue = calculateRevenue(item, { feeAmount, refundAmount, hasAllocatedFees });
  const isCancelled = revenue.financialStatus === 'CANCELLED' || String(item.status || '').toUpperCase() === 'CANCELLED';
  const isZeroCost = isCancelled && !fulfillmentPlan && existingSnapshot?.actualVendorTotalAmount == null;
  const cost = { ...calculateCost(fulfillmentPlan, isZeroCost), estimatedCostCurrency: fulfillmentPlan?.costEstimate?.currency || null };
  if (!fulfillmentPlan && existingSnapshot?.actualVendorTotalAmount != null) {
    cost.costLines = (existingSnapshot.costLines || []).filter(line => line.code === 'LNG_FULFILLMENT_FEE');
  }
  const canonical = calculateSnapshotFinancials({ ...existingSnapshot, ...revenue, ...cost });
  const margin = { grossProfitAmount: canonical.profitBeforeAdsAmount, grossMarginBps: canonical.profitBeforeAdsAmount !== null && revenue.customerPaidAmount > 0 ? Math.round(canonical.profitBeforeAdsAmount / revenue.customerPaidAmount * 10000) : null };
  const payload = {
    orderId: item.orderId,
    orderItemId,
    orderedAt: item.orderedAt || null,
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    fulfillmentPlanId: fulfillmentPlan?.id || null,
    vendorProductId: fulfillmentPlan?.vendorProduct?.id || null,
    vendorCostCenterId: fulfillmentPlan?.vendorCostCenter?.id || null,
    costRateVersion: fulfillmentPlan?.costEstimate?.costRateVersion ?? null,
    costRateEffectiveFrom: fulfillmentPlan?.costEstimate?.costRateEffectiveFrom || null,
    shipmentId: shipment?.id || shipment?.shipmentId || null,
    ...sellerDimensions,
    ...revenue,
    ...cost,
    ...margin,
    ...canonical,
    calculatedAt: new Date(),
  };
  payload.calculationHistory = [
    {
      calculationVersion: payload.calculationVersion,
      calculatedAt: payload.calculatedAt,
      snapshotStatus: payload.snapshotStatus,
      costStatus: payload.costStatus,
      missingCostReason: payload.missingCostReason,
    },
    ...(existingSnapshot?.calculationHistory || []),
  ].slice(0, 20);
  return { item, payload };
}

async function calculateAndUpsertOrderItem(orderItemId, authContext, session) {
  const { item, payload } = await buildSnapshotPayload(orderItemId, authContext);
  const snapshot = await repository.upsertByOrderItem(orderItemId, payload, { session });
  const result = toFinanceSnapshotDto({ ...snapshot, orderPnl: calculateOrderPnl(snapshot) });
  return { item, result };
}

function recalculateOrderItem(orderItemId, authContext, httpContext) {
  return recalculateItem(orderItemId, authContext, httpContext, false);
}

function processRecalculationRequest(orderItemId) {
  return recalculateItem(orderItemId, { system: true, worker: true }, null, true);
}

async function recalculateItem(orderItemId, authContext, httpContext, durableJob) {
  const operationId = recalculationOperationId();
  const work = async (session) => {
    const claim = durableJob && await requests.findPending(orderItemId, session);
    if (durableJob && !claim) return null;
    const { item, result } = await calculateAndUpsertOrderItem(orderItemId, authContext, session);
    await recordRecalculationAudit(
      {
        action: 'FINANCE_ORDER_ITEM_RECALCULATED',
        entityType: 'ORDER_ITEM',
        entityId: orderItemId,
        shopId: item.shopId,
        metadata: { snapshotStatus: result.snapshotStatus, costStatus: result.cost?.costStatus },
        operationId,
      },
      authContext,
      httpContext,
      session,
    );
    if (claim && await requests.complete(claim, session)) {
      for (const batchId of claim.batchIds) {
        await financeImportRepository.markImportBatchRecalculationCompleted(batchId, orderItemId, { session });
      }
    }
    return result;
  };
  const item = await loadOrderItem(orderItemId);
  return withOrderGuard(item.orderId, work);
}

async function recordFailedRequest(orderItemId, version, error) {
  return withFinanceTransaction(async (session) => {
    const claim = await requests.findPending(orderItemId, session);
    if (!claim || claim.requestedVersion !== version) return;
    for (const batchId of claim.batchIds) {
      await financeImportRepository.markImportBatchRecalculationFailed(batchId, orderItemId, error, { session });
    }
    await requests.blockFailedVersion(claim, error, session);
  });
}

async function updateActualVendorCost(orderItemId, vendorCost = {}) {
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) return null;
  return withOrderGuard(item.orderId, (session) => applyActualVendorCost(orderItemId, vendorCost, { session }));
}

async function applyActualVendorCost(orderItemId, vendorCost, options) {
  let existingSnapshot = await repository.findByOrderItem(orderItemId, options);
  if (!existingSnapshot) {
    const { payload } = await buildSnapshotPayload(orderItemId, { system: true });
    existingSnapshot = await repository.upsertByOrderItem(orderItemId, payload, options);
  }
  if (vendorCost.capturedAt && existingSnapshot.actualVendorCapturedAt
    && new Date(vendorCost.capturedAt) < new Date(existingSnapshot.actualVendorCapturedAt)) return toFinanceSnapshotDto(existingSnapshot);
  if (existingSnapshot.actualVendorAllocation?.vendorOrderId && vendorCost.allocation?.vendorOrderId
    && existingSnapshot.actualVendorAllocation.vendorOrderId !== vendorCost.allocation.vendorOrderId) {
    throw appError('Replacement vendor charge needs reconciliation', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  }
  const actualCost = vendorCostFields(vendorCost);
  if (existingSnapshot.calculationVersion === 2 && Object.entries(actualCost).every(([key, value]) =>
    key === 'actualVendorCapturedAt'
      ? new Date(value || 0).getTime() === new Date(existingSnapshot[key] || 0).getTime()
      : isDeepStrictEqual(value, existingSnapshot[key] ?? null))) return toFinanceSnapshotDto(existingSnapshot);
  const canonical = calculateSnapshotFinancials({ ...existingSnapshot, ...actualCost });
  const orderPnl = calculateOrderPnl({ ...existingSnapshot, ...actualCost, ...canonical });
  const calculatedAt = new Date();
  const updated = await repository.updateActualVendorCost(orderItemId, {
    ...actualCost,
    grossProfitAmount: orderPnl.profitAmount,
    grossMarginBps: orderPnl.totalCostAmount !== null && existingSnapshot.customerPaidAmount > 0
      ? Math.round((orderPnl.profitAmount / existingSnapshot.customerPaidAmount) * 10000)
      : null,
    ...canonical,
    calculatedAt,
    calculationHistory: [{ calculatedAt, calculationVersion: 2, snapshotStatus: existingSnapshot.snapshotStatus,
      costStatus: canonical.costStatus, missingCostReason: canonical.missingCostReason }, ...(existingSnapshot.calculationHistory || [])].slice(0, 20),
  }, options);
  return toFinanceSnapshotDto({ ...(updated || existingSnapshot), orderPnl });
}

function orderRecalculateSummary(orderId, snapshots = []) {
  const summary = snapshots.reduce(
    (acc, snapshot) => {
      acc.revenueAmount += snapshot.revenue?.customerPaidAmount || 0;
      if (snapshot.cost?.baseCostAmount !== null && snapshot.cost?.baseCostAmount !== undefined) {
        acc.baseCostAmount += snapshot.cost.baseCostAmount;
      }
      if (snapshot.margin?.grossProfitAmount !== null && snapshot.margin?.grossProfitAmount !== undefined) {
        acc.grossProfitAmount += snapshot.margin.grossProfitAmount;
      }
      if (snapshot.snapshotStatus === financeSnapshotStatuses.MISSING_COST) acc.missingCostCount += 1;
      return acc;
    },
    { revenueAmount: 0, baseCostAmount: 0, grossProfitAmount: 0, missingCostCount: 0 },
  );

  return {
    orderId: String(orderId),
    itemCount: snapshots.length,
    recalculatedCount: snapshots.length,
    missingCostCount: summary.missingCostCount,
    summary: {
      revenueAmount: summary.revenueAmount,
      baseCostAmount: summary.baseCostAmount,
      grossProfitAmount: summary.grossProfitAmount,
    },
    snapshots,
  };
}

async function recalculateOrder(orderId, authContext, httpContext) {
  assertValidObjectId(orderId, 'orderId');
  const operationId = recalculationOperationId();
  return withOrderGuard(orderId, async (session) => {
    const items = await orderPublic.listItemsByOrder(orderId);
    const snapshots = [];
    for (const item of items || []) {
      const calculated = await calculateAndUpsertOrderItem(String(item._id || item.id), authContext, session);
      snapshots.push(calculated.result);
    }
    const result = orderRecalculateSummary(orderId, snapshots);
    await recordRecalculationAudit(
      {
        action: 'FINANCE_ORDER_RECALCULATED',
        entityType: 'ORDER',
        entityId: orderId,
        shopId: items?.[0]?.shopId,
        metadata: {
          itemCount: result.itemCount,
          recalculatedCount: result.recalculatedCount,
          missingCostCount: result.missingCostCount,
        },
        operationId,
      },
      authContext,
      httpContext,
      session,
    );
    return result;
  });
}

async function recalculateOrders(orderIds = [], authContext, httpContext) {
  const uniqueOrderIds = [...new Set((orderIds || []).map(String).filter(Boolean))];
  const succeeded = [];
  const failed = [];
  let recalculatedItemCount = 0;

  for (const orderId of uniqueOrderIds) {
    try {
      const result = await recalculateOrder(orderId, authContext, httpContext);
      recalculatedItemCount += result.recalculatedCount || 0;
      succeeded.push({
        orderId,
        itemCount: result.itemCount,
        recalculatedCount: result.recalculatedCount,
        missingCostCount: result.missingCostCount,
        summary: result.summary,
      });
    } catch (error) {
      failed.push({
        orderId,
        message: error.message,
        code: error.code || 'RECALCULATE_FAILED',
      });
    }
  }

  return {
    totalRequested: uniqueOrderIds.length,
    successCount: succeeded.length,
    failureCount: failed.length,
    recalculatedItemCount,
    succeeded,
    failed,
  };
}

async function getOrderSummary(orderId, authContext, query = {}) {
  assertValidObjectId(orderId, 'orderId');
  const scoped = scopedReadQuery({ ...query, orderId }, authContext);
  const [snapshots, missing] = await Promise.all([repository.listByOrder(orderId, scoped), missingSnapshotItems(scoped)]);
  snapshots.push(...missing.map(item => ({ ...item, orderItemId: item._id, _id: null, calculationVersion: 2,
    costStatus: 'MISSING', profitStatus: 'INCOMPLETE_COST', missingSnapshot: true, missingCostReason: 'SNAPSHOT_NOT_CALCULATED',
    effectiveFulfillmentCostAmount: null, profitBeforeAdsAmount: null })));
  if (authContext) {
    snapshots.forEach((snapshot) => financeAccess.assertSnapshotAccess(snapshot, authContext, financePermissions.READ));
  }
  const orderItems = await orderPublic.findItemsByIds(snapshots.map((s) => String(s.orderItemId)));
  const listingIds = [...new Set(orderItems.map((i) => i.listingId).filter(Boolean).map(String))];
  const listings = listingIds.length ? await catalogPublic.getListingSummariesByIds(listingIds) : [];
  const listingById = new Map(listings.map((l) => [String(l._id || l.id), l]));
  const itemById = new Map(orderItems.map((item) => [String(item._id || item.id), item]));
  return toOrderFinanceSummaryDto(
    orderId,
    snapshots.map((snapshot) => {
      const item = itemById.get(String(snapshot.orderItemId));
      const listing = item?.listingId ? listingById.get(String(item.listingId)) : null;
      return {
        ...snapshot,
        productImageUrl: resolveOrderItemImageUrl(item, listing),
        productTitle: item?.title || listing?.title || null,
        productSku: item?.sku || listing?.sku || null,
        orderPnl: calculateOrderPnl(snapshot),
      };
    }),
  );
}

module.exports = {
  buildSnapshotPayload,
  withOrderGuard,
  recordFailedRequest,
  processRecalculationRequest,
  calculateCost,
  calculateMargin,
  calculateOrderPnl,
  calculateRevenue,
  getOrderSummary,
  getSnapshotByOrderItem,
  exportSnapshotsCsv,
  listSnapshots,
  listFilterOptions,
  listFilterOptionsByQuery,
  listSnapshotsByOrderItemIds,
  recalculateOrder,
  recalculateOrders,
  recalculateOrderItem,
  updateActualVendorCost,
  summarizeBySeller,
  summarizeSellerDaily,
  summarizeByTeam,
  summarizeAdsByChannel,
  summarizeAdsDaily,
  summarizeAdsBySeller,
  summarizeAdsSellerDaily,
  summarizeDaily,
  summarizeQuality,
  summarizeDailyProfit,
  listOrderProfitability,
};
