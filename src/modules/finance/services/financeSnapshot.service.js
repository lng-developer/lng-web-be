const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const mappingPublic = require('../../mapping/public');
const orderPublic = require('../../order/public');
const organizationPublic = require('../../organization/public');
const shipmentPublic = require('../../shipment/public');
const {
  financeCostStatuses,
  financePermissions,
  financeSnapshotStatuses,
  SELLER_DAILY_OPERATING_COST_AMOUNT,
  SELLER_OPERATING_COST_TEAM_CODE,
} = require('../constants/finance.constants');
const repository = require('../repositories/financeSnapshot.repository');
const financeImportRepository = require('../repositories/financeImport.repository');
const {
  toFinanceSnapshotDto,
  toOrderFinanceSummaryDto,
  toPaginatedResponse,
} = require('../dtos/financeSnapshot.dto');

const SHOP_SCOPE_TYPE = 'shop';

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
  return permissions.includes(permission) || (
    permission === financePermissions.READ
    && permissions.includes(financePermissions.WRITE)
  );
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasPermission(authContext, permission)) return;
  const scope = { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId };
  const canAccess = authPublic.canAccessScope(authContext, permission, scope)
    || (permission === financePermissions.READ
      && authPublic.canAccessScope(authContext, financePermissions.WRITE, scope));
  if (!canAccess) {
    throw forbidden();
  }
}

function getScopedReadableShopIds(authContext = {}) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => scope.scopeType === SHOP_SCOPE_TYPE && scope.scopeId
      && ((scope.permissions || []).includes(financePermissions.READ)
        || (scope.permissions || []).includes(financePermissions.WRITE)))
    .map((scope) => String(scope.scopeId)))];
}

function scopedReadQuery(query = {}, authContext) {
  if (!authContext || hasPermission(authContext, financePermissions.READ)) return query;
  const shopIds = getScopedReadableShopIds(authContext);
  if (query.shopId) {
    assertCanAccessShop(query.shopId, financePermissions.READ, authContext);
    return query;
  }
  return { ...query, shopIds };
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
  const taxAmount = moneyAmount(price.itemTaxAmount) + moneyAmount(price.shippingTaxAmount) + moneyAmount(price.giftWrapTaxAmount);
  const shippingAmount = moneyAmount(price.shippingPriceAmount);
  const giftWrapAmount = moneyAmount(price.giftWrapPriceAmount);
  const discountAmount = moneyAmount(price.itemPromotionDiscountAmount) + moneyAmount(price.shipPromotionDiscountAmount);
  const feeAmount = financeTotals.feeAmount !== null && financeTotals.feeAmount !== undefined
    ? moneyAmount(financeTotals.feeAmount)
    : moneyAmount(item.finance?.feeAmount || item.externalData?.finance?.feeAmount);
  const refundAmount = financeTotals.refundAmount !== null && financeTotals.refundAmount !== undefined
    ? moneyAmount(financeTotals.refundAmount)
    : moneyAmount(item.finance?.refundAmount || item.externalData?.finance?.refundAmount);
  const customerPaidAmount = itemPriceAmount + shippingAmount;
  return {
    itemPriceAmount,
    taxAmount,
    shippingAmount,
    giftWrapAmount,
    discountAmount,
    feeAmount,
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
      snapshotStatus: financeSnapshotStatuses.MISSING_COST,
    };
  }

  return {
    baseCostAmount: getCostLineAmount(costEstimate, 'BASE_COST'),
    totalCostAmount: nullableMoneyAmount(costEstimate.totalAmount),
    costLines: (costEstimate.lines || []).map((line) => ({
      code: line.code,
      label: line.label || null,
      amount: moneyAmount(line.amount),
    })),
    costStatus: financeCostStatuses.PRESENT,
    snapshotStatus: financeSnapshotStatuses.ESTIMATED,
  };
}

function calculateMargin({ customerPaidAmount, feeAmount, refundAmount, discountAmount }, baseCostAmount) {
  if (baseCostAmount === null || baseCostAmount === undefined) {
    return { grossProfitAmount: null, grossMarginBps: null };
  }
  const grossProfitAmount = customerPaidAmount - feeAmount - refundAmount - baseCostAmount - discountAmount;
  return {
    grossProfitAmount,
    grossMarginBps: customerPaidAmount > 0
      ? Math.round((grossProfitAmount / customerPaidAmount) * 10000)
      : null,
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
  return item;
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
    result.items.forEach((snapshot) => assertCanAccessShop(snapshot.shopId, financePermissions.READ, authContext));
  }
  const orderItems = await orderPublic.findItemsByIds(
    result.items.map((snapshot) => String(snapshot.orderItemId)),
  );
  const externalOrderIds = new Map(
    orderItems.map((item) => [String(item._id || item.id), item.externalOrderId || null]),
  );
  return {
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
}

async function getSnapshotByOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const snapshot = await repository.findByOrderItem(orderItemId);
  if (!snapshot) return null;
  assertCanAccessShop(snapshot.shopId, financePermissions.READ, authContext);
  return toFinanceSnapshotDto({ ...snapshot, orderPnl: calculateOrderPnl(snapshot) });
}

async function listSnapshotsByOrderItemIds(orderItemIds = [], authContext) {
  const uniqueIds = [...new Set(orderItemIds.map(String).filter(Boolean))];
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  const snapshots = await repository.listByOrderItemIds(uniqueIds);
  if (authContext) {
    snapshots.forEach((snapshot) => assertCanAccessShop(snapshot.shopId, financePermissions.READ, authContext));
  }
  return snapshots.map((snapshot) => toFinanceSnapshotDto({
    ...snapshot,
    orderPnl: calculateOrderPnl(snapshot),
  }));
}

function parseSellerEmployeeCode(sku) {
  const [employeeCode] = String(sku || '').trim().split('-');
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

  const profile = await authPublic.findProfileByEmployeeCode(sellerEmployeeCode);
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

async function summarizeDailyProfit(query = {}) {
  return repository.summarizeDailyProfit(query);
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

async function getOperatingCostContext(query = {}) {
  const team = await organizationPublic.getTeamByCode(SELLER_OPERATING_COST_TEAM_CODE);
  if (!team) return { team: null, members: [], days: 0 };

  const [membersResult, bounds] = await Promise.all([
    organizationPublic.listTeamMembers(team.id),
    query.dateFrom && query.dateTo ? Promise.resolve(null) : repository.findDateBounds(query),
  ]);
  const members = [...(membersResult.leaders || []), ...(membersResult.members || [])]
    .filter((member, index, list) => member?.accountId && list.findIndex((entry) => String(entry.accountId) === String(member.accountId)) === index);
  return {
    team,
    members,
    days: countDays(query.dateFrom || bounds?.dateFrom, query.dateTo || bounds?.dateTo),
  };
}

function applyOperatingCost(row, operatingCostAmount, extra = {}) {
  const revenueAmount = moneyAmount(row.revenueAmount);
  const grossProfitAmount = moneyAmount(row.grossProfitAmount);
  const netProfitAmount = grossProfitAmount - operatingCostAmount;
  return {
    ...row,
    ...extra,
    operatingCostAmount,
    netProfitAmount,
    netMarginBps: revenueAmount > 0 ? Math.round((netProfitAmount / revenueAmount) * 10000) : null,
  };
}

async function summarizeBySeller(query = {}) {
  const [rows, context] = await Promise.all([
    repository.summarizeBySeller(query),
    getOperatingCostContext(query),
  ]);
  const result = [...rows];

  context.members.forEach((member) => {
    const rowIndex = result.findIndex((row) => (
      String(row.sellerAccountId || '') === String(member.accountId)
      || (member.employeeCode && row.sellerEmployeeCode === member.employeeCode)
    ) && row.currency === 'USD');
    if (rowIndex >= 0) {
      result[rowIndex] = {
        ...result[rowIndex],
        sellerAccountId: result[rowIndex].sellerAccountId || member.accountId,
        sellerEmployeeCode: result[rowIndex].sellerEmployeeCode || member.employeeCode || null,
        sellerName: result[rowIndex].sellerName || member.fullName || null,
      };
      return;
    }
    result.push({
      sellerAccountId: member.accountId,
      sellerEmployeeCode: member.employeeCode || null,
      sellerName: member.fullName || null,
      currency: 'USD',
      itemCount: 0,
      revenueAmount: 0,
      baseCostAmount: 0,
      grossProfitAmount: 0,
      grossMarginBps: null,
      missingCostCount: 0,
    });
  });

  const activeAccountIds = new Set(context.members.map((member) => String(member.accountId)));
  return result
    .map((row) => applyOperatingCost(
      row,
      row.currency === 'USD' && activeAccountIds.has(String(row.sellerAccountId))
        ? context.days * SELLER_DAILY_OPERATING_COST_AMOUNT
        : 0,
      { operatingCostDays: row.currency === 'USD' && activeAccountIds.has(String(row.sellerAccountId)) ? context.days : 0 },
    ))
    .sort((left, right) => String(left.sellerEmployeeCode || '').localeCompare(String(right.sellerEmployeeCode || '')));
}

async function summarizeByTeam(query = {}) {
  const [rows, context] = await Promise.all([
    repository.summarizeByTeam(query),
    getOperatingCostContext(query),
  ]);
  const result = [...rows];
  const salesRowIndex = result.findIndex((row) => row.currency === 'USD' && row.teamCode === SELLER_OPERATING_COST_TEAM_CODE);
  if (context.team && salesRowIndex < 0) {
    result.push({
      teamId: context.team.id,
      teamName: context.team.name,
      teamCode: context.team.code,
      departmentId: null,
      departmentName: null,
      departmentCode: null,
      currency: 'USD',
      itemCount: 0,
      revenueAmount: 0,
      baseCostAmount: 0,
      grossProfitAmount: 0,
      grossMarginBps: null,
      missingCostCount: 0,
    });
  }
  return result
    .map((row) => {
      const isSalesTeam = row.currency === 'USD' && row.teamCode === SELLER_OPERATING_COST_TEAM_CODE;
      return applyOperatingCost(
        row,
        isSalesTeam ? context.members.length * context.days * SELLER_DAILY_OPERATING_COST_AMOUNT : 0,
        {
          activeSellerCount: isSalesTeam ? context.members.length : 0,
          operatingCostDays: isSalesTeam ? context.days : 0,
        },
      );
    })
    .sort((left, right) => String(left.teamCode || '').localeCompare(String(right.teamCode || '')));
}

async function recalculateOrderItem(orderItemId, authContext) {
  const item = await loadOrderItem(orderItemId);
  assertCanAccessShop(item.shopId, financePermissions.WRITE, authContext);

  const [fulfillmentPlan, shipment, sellerDimensions] = await Promise.all([
    mappingPublic.getFulfillmentPlanForOrderItem(orderItemId),
    shipmentPublic.getShipmentByOrderItem(orderItemId),
    resolveSellerDimensions(item),
  ]);
  const [feeAmount, refundAmount] = await Promise.all([
    financeImportRepository.sumFeesByOrderItem(orderItemId),
    financeImportRepository.sumRefundsByOrderItem(orderItemId),
  ]);
  const revenue = calculateRevenue(item, { feeAmount, refundAmount });
  const cost = calculateCost(fulfillmentPlan);
  const margin = calculateMargin(revenue, cost.baseCostAmount);
  const payload = {
    orderId: item.orderId,
    orderItemId,
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    fulfillmentPlanId: fulfillmentPlan?.id || null,
    vendorProductId: fulfillmentPlan?.vendorProduct?.id || null,
    vendorCostCenterId: fulfillmentPlan?.vendorCostCenter?.id || null,
    shipmentId: shipment?.id || shipment?.shipmentId || null,
    ...sellerDimensions,
    ...revenue,
    ...cost,
    ...margin,
    calculatedAt: new Date(),
  };
  const snapshot = await repository.upsertByOrderItem(orderItemId, payload);
  return toFinanceSnapshotDto({ ...snapshot, orderPnl: calculateOrderPnl(snapshot) });
}

function orderRecalculateSummary(orderId, snapshots = []) {
  const summary = snapshots.reduce((acc, snapshot) => {
    acc.revenueAmount += snapshot.revenue?.customerPaidAmount || 0;
    if (snapshot.cost?.baseCostAmount !== null && snapshot.cost?.baseCostAmount !== undefined) {
      acc.baseCostAmount += snapshot.cost.baseCostAmount;
    }
    if (snapshot.margin?.grossProfitAmount !== null && snapshot.margin?.grossProfitAmount !== undefined) {
      acc.grossProfitAmount += snapshot.margin.grossProfitAmount;
    }
    if (snapshot.snapshotStatus === financeSnapshotStatuses.MISSING_COST) acc.missingCostCount += 1;
    return acc;
  }, {
    revenueAmount: 0,
    baseCostAmount: 0,
    grossProfitAmount: 0,
    missingCostCount: 0,
  });

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

async function recalculateOrder(orderId, authContext) {
  assertValidObjectId(orderId, 'orderId');
  const items = await orderPublic.listItemsByOrder(orderId);
  const snapshots = [];
  for (const item of items || []) {
    snapshots.push(await recalculateOrderItem(String(item._id || item.id), authContext));
  }
  return orderRecalculateSummary(orderId, snapshots);
}

async function getOrderSummary(orderId, authContext) {
  assertValidObjectId(orderId, 'orderId');
  const snapshots = await repository.listByOrder(orderId);
  if (authContext) {
    snapshots.forEach((snapshot) => assertCanAccessShop(snapshot.shopId, financePermissions.READ, authContext));
  }
  return toOrderFinanceSummaryDto(orderId, snapshots.map((snapshot) => ({
    ...snapshot,
    orderPnl: calculateOrderPnl(snapshot),
  })));
}

module.exports = {
  calculateCost,
  calculateMargin,
  calculateOrderPnl,
  calculateRevenue,
  getOrderSummary,
  getSnapshotByOrderItem,
  listSnapshots,
  listSnapshotsByOrderItemIds,
  recalculateOrder,
  recalculateOrderItem,
  summarizeBySeller,
  summarizeByTeam,
  summarizeAdsByChannel,
  summarizeAdsDaily,
  summarizeAdsBySeller,
  summarizeDaily,
  summarizeDailyProfit,
};
