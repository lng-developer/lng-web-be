const AppError = require('../../../shared/errors/appError');
const mongoose = require('mongoose');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
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
const { toFinanceSnapshotDto, toOrderFinanceSummaryDto, toPaginatedResponse } = require('../dtos/financeSnapshot.dto');

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
  const feeConfidence =
    feeSource === marketplaceFeeSources.ESTIMATED_15_PERCENT
      ? financeFeeConfidences.ESTIMATED
      : financeFeeConfidences.ACTUAL;
  const refundAmount =
    financeTotals.refundAmount !== null && financeTotals.refundAmount !== undefined
      ? moneyAmount(financeTotals.refundAmount)
      : moneyAmount(item.finance?.refundAmount || item.externalData?.finance?.refundAmount);
  return {
    itemPriceAmount,
    taxAmount,
    shippingAmount,
    giftWrapAmount,
    discountAmount,
    feeAmount,
    feeSource,
    feeConfidence,
    refundAmount,
    customerPaidAmount,
    currency: price.currency || 'USD',
  };
}

function getCostLineAmount(costEstimate, code) {
  const line = (costEstimate?.lines || []).find((entry) => entry.code === code);
  return line ? nullableMoneyAmount(line.amount) : null;
}

function calculateCost(fulfillmentPlan) {
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
      label: line.label || null,
      amount: moneyAmount(line.amount),
    })),
    costStatus: financeCostStatuses.PRESENT,
    costBasis: financeCostBases.RATE_CARD,
    snapshotStatus: financeSnapshotStatuses.ESTIMATED,
    missingCostReason: null,
  };
}

function profitStatusFor({ costStatus, costBasis, feeConfidence }) {
  if (costStatus !== financeCostStatuses.PRESENT) return financeProfitStatuses.INCOMPLETE_COST;
  if (costBasis !== financeCostBases.VENDOR_INVOICE || feeConfidence !== financeFeeConfidences.ACTUAL) {
    return financeProfitStatuses.ESTIMATED;
  }
  return financeProfitStatuses.ACTUAL;
}

function calculateMargin({ customerPaidAmount, feeAmount, refundAmount, discountAmount }, totalCostAmount, costStatus) {
  if (totalCostAmount === null || totalCostAmount === undefined || costStatus !== financeCostStatuses.PRESENT) {
    return { grossProfitAmount: null, grossMarginBps: null };
  }
  const grossProfitAmount = customerPaidAmount - feeAmount - refundAmount - totalCostAmount - discountAmount;
  return {
    grossProfitAmount,
    grossMarginBps: customerPaidAmount > 0 ? Math.round((grossProfitAmount / customerPaidAmount) * 10000) : null,
  };
}

function calculateOrderPnl(snapshot = {}) {
  const marketplaceFeeAmount = moneyAmount(snapshot.feeAmount);
  const refundAmount = moneyAmount(snapshot.refundAmount);
  const discountAmount = moneyAmount(snapshot.discountAmount);
  const totalCostAmount = nullableMoneyAmount(snapshot.totalCostAmount);
  if (totalCostAmount === null) {
    return {
      marketplaceFeeAmount,
      refundAmount,
      discountAmount,
      baseCostAmount: null,
      additionalFulfillmentCostAmount: null,
      totalCostAmount: null,
      totalDeductionAmount: null,
      profitAmount: null,
    };
  }

  const baseCostAmount = nullableMoneyAmount(snapshot.baseCostAmount);
  const additionalFulfillmentCostAmount = Math.max(totalCostAmount - (baseCostAmount || 0), 0);
  const totalDeductionAmount = marketplaceFeeAmount + refundAmount + discountAmount + totalCostAmount;
  return {
    marketplaceFeeAmount,
    refundAmount,
    discountAmount,
    baseCostAmount,
    additionalFulfillmentCostAmount,
    totalCostAmount,
    totalDeductionAmount,
    profitAmount: moneyAmount(snapshot.customerPaidAmount) - totalDeductionAmount,
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
  const [result, summaryByCurrency] = await Promise.all([
    repository.list(resolvedSnapshotQuery),
    repository.summarizeOrderPnl(resolvedSnapshotQuery),
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
  const response = {
    ...toPaginatedResponse({
      ...result,
      items: result.items.map((snapshot) => ({
        ...snapshot,
        externalOrderId: externalOrderIds.get(String(snapshot.orderItemId)) || null,
        orderPnl: calculateOrderPnl(snapshot),
      })),
    }),
    summaryByCurrency: summaryByCurrency || [],
  };
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
  const result = await listSnapshots({ ...query, page: 1, limit: query.limit || 5000 }, authContext);
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
    ...result.items.map((snapshot) => [
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

async function summarizeDaily(query = {}) {
  return repository.summarizeDaily(query);
}

async function summarizeQuality(query = {}) {
  return repository.summarizeQuality(query);
}

async function summarizeDailyProfit(query = {}) {
  return repository.summarizeDailyProfit(query);
}

async function listOrderProfitability(query = {}) {
  const result = await repository.listOrderProfitability(query);
  const orderItemIds = result.items.flatMap((row) => (row.orderItemIds || []).map(String));
  const orderItems = await orderPublic.findItemsByIds(orderItemIds);
  const externalOrderIdByItemId = new Map(
    orderItems.map((item) => [String(item._id || item.id), item.externalOrderId || null]),
  );
  return {
    ...result,
    items: result.items.map(({ orderItemIds, orderId, shopId, ...row }) => ({
      ...row,
      orderId: String(orderId),
      shopId: String(shopId),
      externalOrderId: externalOrderIdByItemId.get(String(orderItemIds?.[0])) || null,
    })),
  };
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countDays(dateFrom, dateTo) {
  const start = toDate(dateFrom);
  const end = toDate(dateTo);
  if (!start || !end || end < start) return 0;
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
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
  const [rows, reportDates] = await Promise.all([repository.summarizeBySeller(query), getReportDateKeys(query)]);
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
        row.date >= new Date(start).toISOString().slice(0, 10) &&
        (!end || row.date <= new Date(end).toISOString().slice(0, 10));
      return applies ? [[`${row.sellerAccountId}|${row.date}`, Number(account.operatingCostAmount)]] : [];
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
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index));
    return date.toISOString().slice(0, 10);
  });
}

async function summarizeSellerDaily(query = {}) {
  const rows = await repository.summarizeSellerDaily(query);
  const operatingCosts = await resolveOperatingCosts(rows);
  return rows.map((row) => {
    const operatingCostAmount = operatingCosts.get(`${row.sellerAccountId}|${row.date}`) || 0;
    return applyOperatingCost(row, operatingCostAmount, { operatingCostDays: operatingCostAmount ? 1 : 0 });
  });
}

async function summarizeAdsSellerDaily(query = {}) {
  return repository.summarizeAdsSellerDaily(query);
}

async function summarizeByTeam(query = {}) {
  const rows = await repository.summarizeByTeam(query);
  return rows
    .map((row) => applyOperatingCost(row, 0, { activeSellerCount: 0, operatingCostDays: 0 }))
    .sort((left, right) => String(left.teamCode || '').localeCompare(String(right.teamCode || '')));
}

async function calculateAndUpsertOrderItem(orderItemId, authContext, session) {
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
  const [feeAmount, refundAmount] = await Promise.all([
    financeImportRepository.sumFeesByOrderItem(orderItemId),
    financeImportRepository.sumRefundsByOrderItem(orderItemId),
  ]);
  const revenue = calculateRevenue(item, { feeAmount, refundAmount });
  const cost = calculateCost(fulfillmentPlan);
  const margin = calculateMargin(revenue, cost.totalCostAmount, cost.costStatus);
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
    calculatedAt: new Date(),
  };
  payload.profitStatus = profitStatusFor(payload);
  payload.calculationHistory = [
    {
      calculatedAt: payload.calculatedAt,
      snapshotStatus: payload.snapshotStatus,
      costStatus: payload.costStatus,
      missingCostReason: payload.missingCostReason,
    },
    ...(existingSnapshot?.calculationHistory || []),
  ].slice(0, 20);
  const snapshot = await repository.upsertByOrderItem(orderItemId, payload, { session });
  const result = toFinanceSnapshotDto({ ...snapshot, orderPnl: calculateOrderPnl(snapshot) });
  return { item, result };
}

async function recalculateOrderItem(orderItemId, authContext, httpContext) {
  const operationId = recalculationOperationId();
  return withFinanceTransaction(async (session) => {
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
    return result;
  });
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
  return withFinanceTransaction(async (session) => {
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

async function getOrderSummary(orderId, authContext) {
  assertValidObjectId(orderId, 'orderId');
  const snapshots = await repository.listByOrder(orderId);
  if (authContext) {
    snapshots.forEach((snapshot) => financeAccess.assertSnapshotAccess(snapshot, authContext, financePermissions.READ));
  }
  return toOrderFinanceSummaryDto(
    orderId,
    snapshots.map((snapshot) => ({ ...snapshot, orderPnl: calculateOrderPnl(snapshot) })),
  );
}

module.exports = {
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
  recalculateOrderItem,
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
