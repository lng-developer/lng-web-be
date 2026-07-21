const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderAccess = require('./orderAccess.service');

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function getWritableOrder(orderId, authContext = {}) {
  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound('Order not found');
  orderAccess.assertCanWriteShop(order.shopId, authContext);
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

async function updateOrderItemCsNote(orderItemId, csNote, authContext = {}) {
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');
  orderAccess.assertCanWriteShop(item.shopId, authContext);

  const result = await orderItemRepository.updateCsNote(orderItemId, csNote);
  if (!result) throw notFound('Order item not found');

  const productionPublic = require('../../production/public');
  await productionPublic.syncCsNoteFromOrderItem(orderItemId, csNote, authContext);
  return result;
}

module.exports = {
  updateBuyer,
  updateShippingService,
  updateOrderItemCsNote,
};
