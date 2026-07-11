const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const mappingPublic = require('../../mapping/public');
const orderPublic = require('../../order/public');
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

async function recalculateOrderItem(orderItemId, authContext) {
  const item = await loadOrderItem(orderItemId);
  assertCanAccessShop(item.shopId, financePermissions.WRITE, authContext);

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
    ...revenue,
    ...cost,
    ...margin,
    calculatedAt: new Date(),
  };
  return toFinanceSnapshotDto(await repository.upsertByOrderItem(orderItemId, payload));
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
  recalculateOrderItem,
};
