const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');

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

async function updateOrderItemCsNote(orderItemId, csNote, authContext = {}) {
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');
  assertCanWriteShop(item.shopId, authContext);

  const result = await orderItemRepository.updateCsNote(orderItemId, csNote);
  if (!result) throw notFound('Order item not found');

  const productionPublic = require('../../production/public');
  await productionPublic.syncCsNoteFromOrderItem(orderItemId, csNote, authContext);
  return result;
}

module.exports = {
  updateBuyer,
  updateShippingService,
  updateCaseStatus,
  updateOrderItemCsNote,
};
