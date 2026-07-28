const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderTimelineService = require('./orderTimeline.service');
const orderItemStatusTransitionService = require('./orderItemStatusTransition.service');
const orderAccess = require('./orderAccess.service');
const { addressValidationStatuses, orderItemStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const { recordOrderOperation } = require('./orderOperationAudit.service');

const TARGET_STATUS = orderItemStatuses.FULFILLMENT_READY;
const BAD_ITEM_STATUSES = new Set([
  orderItemStatuses.CANCELLED,
  orderItemStatuses.REFUNDED,
  orderItemStatuses.FAILED,
  orderItemStatuses.SHIPPED,
]);
const READY_ADDRESS_STATUSES = new Set([
  addressValidationStatuses.VALID,
  addressValidationStatuses.OVERRIDDEN,
]);

function getCustomizationPublic() {
  return require('../../customization/public');
}

function getIntegrationPublic() {
  return require('../../integration/public');
}

function getMappingPublic() {
  return require('../../mapping/public');
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
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
    if (error.statusCode !== httpStatus.CONFLICT || error.code !== errorCodes.CONFLICT_ERROR) {
      throw error;
    }
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

async function getMappingCheck(item) {
  const plan = await getMappingPublic().getFulfillmentPlanForOrderItem(item._id);
  return {
    ok: ['READY', 'CONFIRMED'].includes(plan?.status),
    status: plan?.status || null,
  };
}

async function getOrderItemReadiness(orderItemId, authContext) {
  const { order, item } = await loadOrderAndItem(orderItemId);
  if (authContext) orderAccess.assertCanReadShop(item.shopId, authContext);
  const customization = await getCustomizationCheck(item);
  const [mapping, { issues, check: blockingIssues }] = await Promise.all([
    getMappingCheck(item),
    getBlockingIssuesCheck(item),
  ]);
  const address = {
    ok: READY_ADDRESS_STATUSES.has(order.addressValidationStatus),
    status: order.addressValidationStatus,
  };
  const itemStatus = {
    ok: !BAD_ITEM_STATUSES.has(item.status),
    status: item.status,
  };

  const blockingReasons = [];
  if (!address.ok) blockingReasons.push('ADDRESS_NOT_VALID');
  if (!customization.ok) blockingReasons.push('CUSTOMIZATION_NOT_READY');
  if (!mapping.ok) blockingReasons.push('MAPPING_NOT_READY');
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
      mapping,
      blockingIssues,
      itemStatus,
    },
    blockingReasons: [...new Set(blockingReasons)],
  };
}

async function markFulfillmentReady(orderItemId, authContext) {
  const { order, item } = await loadOrderAndItem(orderItemId);
  if (authContext) orderAccess.assertCanWriteShop(item.shopId, authContext);

  const readiness = await getOrderItemReadiness(orderItemId, authContext);
  if (!readiness.ready) {
    throw conflict(readiness);
  }

  const updated = await orderItemStatusTransitionService.transitionItemStatus(orderItemId, TARGET_STATUS, {
    source: 'ORDER_READINESS',
  });
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
  await recordOrderOperation({
    action: 'ORDER_ITEM_FULFILLMENT_READY', entityType: 'ORDER_ITEM', entityId: orderItemId,
    shopId: item.shopId, authContext: authContext || {},
    changes: { status: { from: item.status || null, to: TARGET_STATUS } },
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
