const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const AppError = require('../../../shared/errors/appError');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const orderTimelineRepository = require('../repositories/orderTimeline.repository');

function assertRequired(value, field) {
  if (!value) {
    throw new AppError(
      `${field} is required`,
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
      { field },
    );
  }
}

function assertEnumValue(value, values, field) {
  if (!values.includes(value)) {
    throw new AppError(
      `${field} is invalid`,
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
      { field, value },
    );
  }
}

async function appendTimeline(payload = {}) {
  assertRequired(payload.orderId, 'orderId');
  assertRequired(payload.shopId, 'shopId');
  assertRequired(payload.eventType, 'eventType');
  assertEnumValue(payload.eventType, Object.values(orderTimelineEventTypes), 'eventType');

  if (payload.source) {
    assertEnumValue(payload.source, Object.values(orderTimelineSources), 'source');
  }

  return orderTimelineRepository.create(payload);
}

async function listByOrder(orderId, params = {}) {
  return orderTimelineRepository.listByOrder(orderId, params);
}

async function listByOrderItem(orderItemId, params = {}) {
  return orderTimelineRepository.listByOrderItem(orderItemId, params);
}

module.exports = {
  appendTimeline,
  listByOrder,
  listByOrderItem,
};
