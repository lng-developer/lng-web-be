const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderTimelineService = require('./orderTimeline.service');
const { addressValidationStatuses, orderItemStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');

const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';
const TARGET_STATUS = orderItemStatuses.FULFILLMENT_READY;
const BAD_ITEM_STATUSES = new Set([
  orderItemStatuses.CANCELLED,
  orderItemStatuses.REFUNDED,
  orderItemStatuses.FAILED,
  orderItemStatuses.SHIPPED,
]);

function getCustomizationPublic() {
  return require('../../customization/public');
}

function getIntegrationPublic() {
  return require('../../integration/public');
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function conflict(checklist) {
  return new AppError(
    'Order item is not ready for fulfillment',
    httpStatus.CONFLICT,
    true,
    errorCodes.CONFLICT_ERROR,
    checklist,
  );
}

function hasGlobalOrderWrite(authContext = {}) {
  return (authContext.permissions || []).includes(ORDER_WRITE_PERMISSION);
}

function hasGlobalOrderRead(authContext = {}) {
  const permissions = authContext.permissions || [];
  return permissions.includes(ORDER_READ_PERMISSION) || permissions.includes(ORDER_WRITE_PERMISSION);
}

function assertCanReadShop(shopId, authContext) {
  if (!authContext || hasGlobalOrderRead(authContext)) return;

  const canRead = authPublic.canAccessScope(authContext, ORDER_READ_PERMISSION, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  });
  const canWrite = authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  });

  if (!canRead && !canWrite) {
    throw forbidden();
  }
}

function assertCanWriteShop(shopId, authContext) {
  if (!authContext || hasGlobalOrderWrite(authContext)) return;

  if (!authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

function itemNeedsCustomization(item) {
  return Boolean(item?.customizationRawSummary?.hasCustomization);
}

async function loadOrderAndItem(orderItemId) {
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');

  const order = await orderRepository.findById(item.orderId);
  if (!order) throw notFound('Order not found');

  return { order, item };
}

async function getCustomizationCheck(item) {
  if (!itemNeedsCustomization(item)) {
    return { ok: true, status: 'NOT_REQUIRED' };
  }

  try {
    const payload = await getCustomizationPublic().assertCustomizationReady(item._id);
    return { ok: true, status: payload.status };
  } catch (error) {
    return { ok: false, status: 'NOT_READY' };
  }
}

async function getBlockingIssuesCheck(item) {
  const issues = await getIntegrationPublic().externalOrderImport.listOpenIssuesForExternalItem({
    externalOrderId: item.externalOrderId,
    externalItemId: item.externalItemId,
  });

  return {
    issues,
    check: { ok: issues.length === 0, count: issues.length },
  };
}

async function getOrderItemReadiness(orderItemId, authContext) {
  const { order, item } = await loadOrderAndItem(orderItemId);
  assertCanReadShop(item.shopId, authContext);
  const customization = await getCustomizationCheck(item);
  const { issues, check: blockingIssues } = await getBlockingIssuesCheck(item);
  const address = {
    ok: order.addressValidationStatus === addressValidationStatuses.VALID,
    status: order.addressValidationStatus,
  };
  const itemStatus = {
    ok: !BAD_ITEM_STATUSES.has(item.status),
    status: item.status,
  };

  const blockingReasons = [];
  if (!address.ok) blockingReasons.push('ADDRESS_NOT_VALID');
  if (!customization.ok) blockingReasons.push('CUSTOMIZATION_NOT_READY');
  if (!blockingIssues.ok) {
    issues.forEach((issue) => blockingReasons.push(issue.issueType || 'OPEN_ISSUE'));
  }
  if (!itemStatus.ok) blockingReasons.push('ITEM_STATUS_BLOCKED');

  return {
    orderItemId: String(item._id),
    orderId: String(order._id),
    ready: blockingReasons.length === 0,
    targetStatus: TARGET_STATUS,
    checks: {
      address,
      customization,
      blockingIssues,
      itemStatus,
    },
    blockingReasons: [...new Set(blockingReasons)],
  };
}

async function markFulfillmentReady(orderItemId, authContext) {
  const { order, item } = await loadOrderAndItem(orderItemId);
  assertCanWriteShop(item.shopId, authContext);

  const readiness = await getOrderItemReadiness(orderItemId, authContext);
  if (!readiness.ready) {
    throw conflict(readiness);
  }

  const updated = await orderItemRepository.updateStatus(orderItemId, TARGET_STATUS);
  if (!updated) throw notFound('Order item not found');

  await orderTimelineService.appendTimeline({
    orderId: order._id,
    orderItemId: item._id,
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    eventType: orderTimelineEventTypes.FULFILLMENT_PLAN_READY,
    source: authContext ? orderTimelineSources.USER : orderTimelineSources.SYSTEM,
  });

  return {
    item: updated,
    readiness: {
      ...readiness,
      checks: {
        ...readiness.checks,
        itemStatus: { ok: true, status: TARGET_STATUS },
      },
    },
  };
}

module.exports = {
  getOrderItemReadiness,
  markFulfillmentReady,
};
