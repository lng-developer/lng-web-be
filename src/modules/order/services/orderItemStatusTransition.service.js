const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { orderItemStatuses, orderStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderTimelineService = require('./orderTimeline.service');

const transitions = Object.freeze({
  [orderItemStatuses.NEW]: [
    orderItemStatuses.MAPPING_PENDING,
    orderItemStatuses.CUSTOMIZATION_PENDING,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.CUSTOMIZATION_PENDING]: [
    orderItemStatuses.CUSTOMIZATION_PARSED,
    orderItemStatuses.MAPPING_PENDING,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.CUSTOMIZATION_PARSED]: [
    orderItemStatuses.MAPPING_PENDING,
    orderItemStatuses.FULFILLMENT_PLANNING,
    orderItemStatuses.FULFILLMENT_READY,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.MAPPING_PENDING]: [
    orderItemStatuses.FULFILLMENT_PLANNING,
    orderItemStatuses.FULFILLMENT_READY,
    orderItemStatuses.NEED_PRODUCTION,
    orderItemStatuses.READY_TO_SEND_VENDOR,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.FULFILLMENT_PLANNING]: [
    orderItemStatuses.NEED_PRODUCTION,
    orderItemStatuses.READY_TO_SEND_VENDOR,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.FULFILLMENT_READY]: [
    orderItemStatuses.NEED_PRODUCTION,
    orderItemStatuses.READY_TO_SEND_VENDOR,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.NEED_PRODUCTION]: [
    orderItemStatuses.IN_PRODUCTION,
    orderItemStatuses.READY_TO_SEND_VENDOR,
    orderItemStatuses.QC_REJECTED,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.IN_PRODUCTION]: [
    orderItemStatuses.READY_TO_SEND_VENDOR,
    orderItemStatuses.QC_REJECTED,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.QC_REJECTED]: [
    orderItemStatuses.IN_PRODUCTION,
    orderItemStatuses.NEED_PRODUCTION,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.READY_TO_SEND_VENDOR]: [
    orderItemStatuses.SENT_TO_VENDOR,
    orderItemStatuses.CANCELLED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.SENT_TO_VENDOR]: [
    orderItemStatuses.TRACKING_PENDING,
    orderItemStatuses.SHIPPED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.TRACKING_PENDING]: [
    orderItemStatuses.SHIPPED,
    orderItemStatuses.FAILED,
  ],
  [orderItemStatuses.SHIPPED]: [],
  [orderItemStatuses.CANCELLED]: [],
  [orderItemStatuses.REFUNDED]: [],
  [orderItemStatuses.FAILED]: [],
});

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function assertKnownStatus(status) {
  if (!Object.values(orderItemStatuses).includes(status)) {
    throw appError('Invalid order item status', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, {
      status,
    });
  }
}

function canTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  return (transitions[fromStatus] || []).includes(toStatus);
}

function deriveOrderStatusFromItems(items = []) {
  const statuses = items.map((item) => item.status || orderItemStatuses.NEW);
  if (statuses.length === 0) return orderStatuses.IMPORTED;
  if (statuses.every((status) => status === orderItemStatuses.CANCELLED)) return orderStatuses.CANCELLED;
  if (statuses.every((status) => status === orderItemStatuses.REFUNDED)) return orderStatuses.REFUNDED;
  if (statuses.every((status) => status === orderItemStatuses.FAILED)) return orderStatuses.FAILED;
  if (statuses.every((status) => status === orderItemStatuses.SHIPPED)) return orderStatuses.SHIPPED;
  if (statuses.some((status) => status === orderItemStatuses.SHIPPED)) return orderStatuses.PARTIALLY_SHIPPED;
  if (statuses.some((status) => [
    orderItemStatuses.CUSTOMIZATION_PENDING,
    orderItemStatuses.CUSTOMIZATION_PARSED,
    orderItemStatuses.MAPPING_PENDING,
    orderItemStatuses.FULFILLMENT_PLANNING,
    orderItemStatuses.FULFILLMENT_READY,
    orderItemStatuses.NEED_PRODUCTION,
    orderItemStatuses.IN_PRODUCTION,
    orderItemStatuses.QC_REJECTED,
    orderItemStatuses.READY_TO_SEND_VENDOR,
    orderItemStatuses.SENT_TO_VENDOR,
    orderItemStatuses.TRACKING_PENDING,
  ].includes(status))) return orderStatuses.PROCESSING;
  return orderStatuses.IMPORTED;
}

function getTimelineSource(context = {}) {
  return Object.values(orderTimelineSources).includes(context.source)
    ? context.source
    : orderTimelineSources.SYSTEM;
}

async function appendItemStatusTimeline(item, targetStatus, context = {}) {
  return orderTimelineService.appendTimeline({
    orderId: item.orderId,
    orderItemId: item._id || item.id,
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    eventType: orderTimelineEventTypes.ORDER_ITEM_STATUS_CHANGED,
    fromStatus: item.status || orderItemStatuses.NEW,
    toStatus: targetStatus,
    source: getTimelineSource(context),
    actorId: context.actorId || context.accountId || null,
  });
}

async function appendOrderStatusTimeline(order, nextStatus, context = {}) {
  if (!order || order.status === nextStatus) return null;
  return orderTimelineService.appendTimeline({
    orderId: order._id || order.id,
    shopId: order.shopId,
    salesChannelCode: order.salesChannelCode,
    marketplaceCode: order.marketplaceCode,
    eventType: orderTimelineEventTypes.ORDER_STATUS_CHANGED,
    fromStatus: order.status,
    toStatus: nextStatus,
    source: getTimelineSource(context),
    actorId: context.actorId || context.accountId || null,
  });
}

async function syncParentOrderStatus(orderId, context = {}) {
  if (!orderId) return null;
  const [order, items] = await Promise.all([
    orderRepository.findById(orderId),
    orderItemRepository.listAllByOrder(orderId),
  ]);
  const nextStatus = deriveOrderStatusFromItems(items);
  const updated = await orderRepository.updateStatus(orderId, nextStatus);
  await appendOrderStatusTimeline(order, nextStatus, context);
  return updated;
}

async function markOrderDelivered(orderId, deliveredAt = new Date(), context = {}) {
  const updated = await orderRepository.updateDeliveredAt(orderId, deliveredAt);
  if (updated) {
    await orderTimelineService.appendTimeline({
      orderId,
      shopId: updated.shopId,
      salesChannelCode: updated.salesChannelCode,
      marketplaceCode: updated.marketplaceCode,
      eventType: orderTimelineEventTypes.ORDER_DELIVERED,
      source: getTimelineSource(context),
      actorId: context.actorId || context.accountId || null,
      metadata: { deliveredAt },
    });
  }
  return updated;
}

async function transitionItemStatus(orderItemId, targetStatus, context = {}) {
  assertKnownStatus(targetStatus);
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) {
    throw appError('Order item not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  }

  const currentStatus = item.status || orderItemStatuses.NEW;
  if (!canTransition(currentStatus, targetStatus)) {
    throw appError('Invalid order item status transition', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, {
      orderItemId,
      fromStatus: currentStatus,
      targetStatus,
      source: context.source || null,
    });
  }

  if (currentStatus === targetStatus) return item;
  const updated = await orderItemRepository.updateStatus(orderItemId, targetStatus);
  await appendItemStatusTimeline(item, targetStatus, context);
  await syncParentOrderStatus(updated.orderId || item.orderId, context);
  return updated;
}

module.exports = {
  canTransition,
  deriveOrderStatusFromItems,
  markOrderDelivered,
  transitionItemStatus,
};
