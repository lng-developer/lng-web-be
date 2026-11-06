const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const orderRepository = require('../repositories/order.repository');
const itemRepository = require('../repositories/orderItem.repository');

const blockedStatuses = new Set(['CANCELLED', 'CANCELED', 'PARTIALLY_CANCELLED', 'CANCELLATION_PENDING']);
const cancellableStatuses = new Set([
  'NEW',
  'CUSTOMIZATION_PENDING',
  'CUSTOMIZATION_PARSED',
  'MAPPING_PENDING',
  'FULFILLMENT_PLANNING',
  'FULFILLMENT_READY',
  'NEED_PRODUCTION',
  'READY_TO_SEND_VENDOR',
]);
const terminalStatuses = new Set(['CANCELLED', 'REFUNDED']);

function isBlocked(order) {
  return order?.salesChannelCode === 'AMAZON' && (
    blockedStatuses.has(order.externalStatus) || terminalStatuses.has(order.status) || order.paymentStatus === 'REFUNDED'
  );
}

function reviewError(order) {
  return new AppError('Amazon cancellation requires manual review before fulfillment', 409, true,
    errorCodes.CONFLICT_ERROR, { orderId: String(order._id || order.id), externalStatus: order.externalStatus });
}

async function assertCanFulfill(orderId, orderItemId, preloadedOrder = null) {
  const order = preloadedOrder || await orderRepository.findById(orderId);
  if (!order) throw new AppError('Order not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
  if (isBlocked(order)) throw reviewError(order);
  if (order.salesChannelCode === 'AMAZON' && orderItemId) {
    const item = await itemRepository.findById(orderItemId);
    if (!item || String(item.orderId) !== String(orderId) || terminalStatuses.has(item.status) || blockedStatuses.has(item.externalStatus)) {
      throw reviewError(order);
    }
  }
}

async function reconcile(order) {
  if (order?.salesChannelCode !== 'AMAZON') return false;
  const items = await itemRepository.listAllByOrder(order._id || order.id);
  if (items.length && items.every((item) => terminalStatuses.has(item.status))) return true;
  if (!isBlocked(order)) return false;
  if (!blockedStatuses.has(order.externalStatus)) return false;

  const active = items.filter((item) => !terminalStatuses.has(item.status));
  if (!active.length) return true;

  const context = {
    system: true,
    source: 'IMPORT',
    scopes: [{ scopeType: 'shop', scopeId: String(order.shopId), permissions: ['ORDERS:WRITE'] }],
  };

  const vendor = require('../../vendorSubmission/public');
  const submissions = await Promise.all(active.map((item) => vendor.getByOrderItemId(item._id || item.id)));

  if (submissions.some((s) => ['SUBMITTED', 'SUBMITTING', 'NEEDS_REVIEW'].includes(s?.status))
    || active.some((item) => !cancellableStatuses.has(item.status))) {
    const caseService = require('./orderCase.service');
    await caseService.ensureOpenOrderCase({
      orderId: String(order._id || order.id),
      caseType: 'OTHER',
      severity: 'HIGH',
      title: 'Amazon order cancelled after submission',
      description: 'Buyer cancelled on Amazon but order was already in production or submitted to vendor.',
    }, context);
    return false;
  }

  const { cancelOrderItem } = require('./orderItemCancel.service');
  for (const item of active) {
    await cancelOrderItem(item._id || item.id, { reason: 'Amazon confirmed cancellation' }, context);
  }
  return true;
}

module.exports = { isBlocked, assertCanFulfill, reconcile };
