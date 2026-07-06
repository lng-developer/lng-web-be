const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { orderItemStatuses } = require('../constants/orderStatuses');
const orderItemRepository = require('../repositories/orderItem.repository');

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
  return orderItemRepository.updateStatus(orderItemId, targetStatus);
}

module.exports = {
  canTransition,
  transitionItemStatus,
};
