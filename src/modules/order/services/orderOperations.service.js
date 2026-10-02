const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderAccess = require('./orderAccess.service');
const orderWorkbenchProjectionService = require('./orderWorkbenchProjection.service');
const { recordOrderOperation, withOrderOperation } = require('./orderOperationAudit.service');

function changedFields(current = {}, patch = {}) {
  return Object.keys(patch).filter((field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(patch[field] ?? null));
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict() {
  return new AppError('Order was changed by another request', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

async function getWritableOrder(orderId, authContext = {}) {
  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound('Order not found');
  orderAccess.assertCanWriteOrder(order, authContext);
  return order;
}

async function updateBuyer(orderId, patch, authContext = {}) {
  const order = await getWritableOrder(orderId, authContext);
  const buyer = {
    ...(order.buyer || {}),
    ...patch,
  };
  const fields = changedFields(order.buyer, patch);
  if (!fields.length) return order;
  return withOrderOperation(async (session) => {
    const result = await orderRepository.updateBuyer(orderId, buyer, {
      session,
      expectedUpdatedAt: order.updatedAt,
    });
    if (!result) throw conflict();
    await orderWorkbenchProjectionService.updateOrderWorkbenchOrder(orderId, {
      'order.buyer': result.buyer,
    }, { source: 'ORDER_CUSTOMER', session });
    await recordOrderOperation({
      action: 'ORDER_CUSTOMER_UPDATED', entityType: 'ORDER', entityId: orderId,
      shopId: order.shopId, authContext, session, changes: { fields },
    });
    return result;
  });
}

async function updateShippingService(orderId, patch, authContext = {}) {
  const order = await getWritableOrder(orderId, authContext);
  const shippingService = {
    ...(order.shippingService || {}),
    ...patch,
  };
  const fields = changedFields(order.shippingService, patch);
  if (!fields.length) return order;
  return withOrderOperation(async (session) => {
    const result = await orderRepository.updateShippingService(orderId, shippingService, {
      session,
      expectedUpdatedAt: order.updatedAt,
    });
    if (!result) throw conflict();
    await orderWorkbenchProjectionService.updateOrderWorkbenchOrder(orderId, {
      'order.shippingService': result.shippingService,
    }, { source: 'ORDER_SHIPPING_SERVICE', session });
    await recordOrderOperation({
      action: 'ORDER_SHIPPING_SERVICE_UPDATED', entityType: 'ORDER', entityId: orderId,
      shopId: order.shopId, authContext, session, changes: { fields },
    });
    return result;
  });
}

async function updateOrderItemCsNote(orderItemId, csNote, authContext = {}) {
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');
  const order = await orderRepository.findById(item.orderId);
  if (!order) throw notFound('Order not found');
  orderAccess.assertCanWriteOrder(order, authContext);
  if ((item.csNote || null) === (csNote || null)) return item;

  const result = await orderItemRepository.updateCsNote(orderItemId, csNote);
  if (!result) throw notFound('Order item not found');

  const productionPublic = require('../../production/public');
  await productionPublic.syncCsNoteFromOrderItem(orderItemId, csNote, authContext);
  await orderWorkbenchProjectionService.updateOrderWorkbenchItem(
    result.orderId,
    orderItemId,
    { 'item.csNote': result.csNote },
    { source: 'ORDER_ITEM_CS_NOTE' },
  );
  await recordOrderOperation({
    action: 'ORDER_ITEM_CS_NOTE_UPDATED', entityType: 'ORDER_ITEM', entityId: orderItemId,
    shopId: item.shopId, authContext, metadata: { notePresent: Boolean(csNote) },
  });
  return result;
}

module.exports = {
  updateBuyer,
  updateShippingService,
  updateOrderItemCsNote,
};
