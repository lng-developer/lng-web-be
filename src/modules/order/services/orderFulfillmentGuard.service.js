const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const orderRepository = require('../repositories/order.repository');
const etsyOrderStatusService = require('./etsyOrderStatus.service');
const amazonOrderStatusService = require('./amazonOrderStatus.service');

async function assertMarketplaceAllowsFulfillment(orderId, orderItemId) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (order.salesChannelCode === 'ETSY') {
    return etsyOrderStatusService.assertCanFulfill(orderId, orderItemId);
  }

  if (order.salesChannelCode === 'AMAZON') {
    return amazonOrderStatusService.assertCanFulfill(orderId, orderItemId, order);
  }
}

module.exports = {
  assertMarketplaceAllowsFulfillment,
};
