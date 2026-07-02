const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const orderRepository = require('../repositories/order.repository');

const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalWrite(authContext = {}) {
  return (authContext.permissions || []).includes(ORDER_WRITE_PERMISSION);
}

function assertCanWriteShop(shopId, authContext = {}) {
  if (hasGlobalWrite(authContext)) return;

  if (!authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

async function getWritableOrder(orderId, authContext = {}) {
  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound('Order not found');
  assertCanWriteShop(order.shopId, authContext);
  return order;
}

async function updateBuyer(orderId, patch, authContext = {}) {
  const order = await getWritableOrder(orderId, authContext);
  const result = await orderRepository.updateBuyer(orderId, {
    ...(order.buyer || {}),
    ...patch,
  });
  if (!result) throw notFound('Order not found');
  return result;
}

async function updateShippingService(orderId, patch, authContext = {}) {
  const order = await getWritableOrder(orderId, authContext);
  const result = await orderRepository.updateShippingService(orderId, {
    ...(order.shippingService || {}),
    ...patch,
  });
  if (!result) throw notFound('Order not found');
  return result;
}

async function updateCaseStatus(orderId, caseStatus, authContext = {}) {
  await getWritableOrder(orderId, authContext);
  const result = await orderRepository.updateCaseStatus(orderId, caseStatus);
  if (!result) throw notFound('Order not found');
  return result;
}

module.exports = {
  updateBuyer,
  updateShippingService,
  updateCaseStatus,
};
