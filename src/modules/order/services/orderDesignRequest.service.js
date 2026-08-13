const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderAccess = require('./orderAccess.service');

function getMappingPublic() {
  return require('../../mapping/public');
}

function getDesignPublic() {
  return require('../../design/public');
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict(message, details) {
  return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, details);
}

function internalContext(authContext = {}, source) {
  return { ...authContext, system: true, source };
}

async function requestPsdForOrderItem(orderItemId, payload = {}, authContext = {}) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');

  const order = await orderRepository.findById(item.orderId);
  if (!order) throw notFound('Order not found');
  orderAccess.assertCanReadOrder(order, authContext);

  const plan = await getMappingPublic().getFulfillmentPlanForOrderItem(
    orderItemId,
    internalContext(authContext, 'ORDER_DESIGN_REQUEST_PLAN_READ'),
  );
  if (!item.listingId || !plan?.listingVariantId) {
    throw conflict('Order item must have a mapped listing variant before requesting PSD');
  }

  return getDesignPublic().createPsdTemplateTaskFromListingVariant(
    String(item.listingId),
    String(plan.listingVariantId),
    {
      note: payload.note || `Requested from order ${order.externalOrderId || order._id || order.id}`,
    },
    internalContext(authContext, 'ORDER_DESIGN_REQUEST'),
  );
}

module.exports = {
  requestPsdForOrderItem,
};
