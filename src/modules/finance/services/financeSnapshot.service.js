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
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
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

async function loadOrderItem(orderItemId) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  return item;
}

async function listSnapshots(query = {}, authContext) {
  const result = await repository.list(query);
  if (authContext) {
    result.items.forEach((snapshot) => assertCanAccessShop(snapshot.shopId, financePermissions.READ, authContext));
  }
  return toPaginatedResponse(result);
}

async function getSnapshotByOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const snapshot = await repository.findByOrderItem(orderItemId);
  if (!snapshot) return null;
  assertCanAccessShop(snapshot.shopId, financePermissions.READ, authContext);
  return toFinanceSnapshotDto(snapshot);
}

async function listSnapshotsByOrderItemIds(orderItemIds = [], authContext) {
  const uniqueIds = [...new Set(orderItemIds.map(String).filter(Boolean))];
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  const snapshots = await repository.listByOrderItemIds(uniqueIds);
  if (authContext) {
    snapshots.forEach((snapshot) => assertCanAccessShop(snapshot.shopId, financePermissions.READ, authContext));
  }
  return snapshots.map(toFinanceSnapshotDto);
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

async function summarizeBySeller(query = {}) {
  return repository.summarizeBySeller(query);
}

async function summarizeByTeam(query = {}) {
  return repository.summarizeByTeam(query);
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
  return toFinanceSnapshotDto(await repository.upsertByOrderItem(orderItemId, payload));
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
  return toOrderFinanceSummaryDto(orderId, snapshots);
}

module.exports = {
  calculateCost,
  calculateMargin,
  calculateRevenue,
  getOrderSummary,
  getSnapshotByOrderItem,
  listSnapshots,
  listSnapshotsByOrderItemIds,
  recalculateOrder,
  recalculateOrderItem,
  summarizeBySeller,
  summarizeByTeam,
  summarizeDaily,
  summarizeDailyProfit,
};
