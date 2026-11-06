const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const orderRepository = require('../repositories/order.repository');
const itemRepository = require('../repositories/orderItem.repository');

const blockedStatuses = new Set(['CANCELLED', 'PARTIALLY_CANCELLED', 'CANCELLATION_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED']);
const cancellableStatuses = new Set(['NEW', 'CUSTOMIZATION_PENDING', 'CUSTOMIZATION_PARSED', 'MAPPING_PENDING', 'FULFILLMENT_PLANNING', 'FULFILLMENT_READY', 'NEED_PRODUCTION', 'READY_TO_SEND_VENDOR']);
const terminalStatuses = new Set(['CANCELLED', 'REFUNDED']);

function isBlocked(order) {
  return order?.salesChannelCode === 'ETSY' && (
    blockedStatuses.has(order.externalStatus) || terminalStatuses.has(order.status) || order.paymentStatus === 'REFUNDED'
  );
}

function reviewError(order) {
  return new AppError('Etsy cancellation/refund requires manual review before fulfillment', 409, true,
    errorCodes.CONFLICT_ERROR, { orderId: String(order._id || order.id), externalStatus: order.externalStatus });
}

async function createReviewCase(order, context, reason) {
  const orderPublic = require('../public');
  const isRefund = ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.externalStatus)
    || order.paymentStatus === 'REFUNDED';
  return orderPublic.ensureOpenOrderCase({
    orderId: String(order._id || order.id),
    caseType: isRefund ? 'REFUND' : 'OTHER',
    severity: 'HIGH',
    title: isRefund ? 'Etsy refund requires review' : 'Etsy cancellation requires review',
    description: `${reason} External status: ${order.externalStatus || 'UNKNOWN'}.`,
  }, context);
}

async function assertCanFulfill(orderId, orderItemId) {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Order not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
  if (isBlocked(order)) throw reviewError(order);
  if (order.salesChannelCode === 'ETSY' && orderItemId) {
    const item = await itemRepository.findById(orderItemId);
    if (!item || String(item.orderId) !== String(orderId) || terminalStatuses.has(item.status)) throw reviewError(order);
  }
}

async function reconcile(order) {
  if (order.salesChannelCode !== 'ETSY') return false;
  const items = await itemRepository.listAllByOrder(order._id || order.id);
  if (items.length && items.every(item => terminalStatuses.has(item.status))) return true;
  if (!isBlocked(order)) return false;
  const context = { system: true, source: 'IMPORT', scopes: [{ scopeType: 'shop', scopeId: String(order.shopId), permissions: ['ORDERS:WRITE'] }] };
  if (order.externalStatus !== 'CANCELLED') {
    await createReviewCase(order, context, 'Etsy reported a refund or non-terminal cancellation state.');
    throw reviewError(order);
  }

  const active = items.filter(item => !terminalStatuses.has(item.status));
  const production = require('../../production/public');
  const vendor = require('../../vendorSubmission/public');
  const [tasks, submissions] = await Promise.all([
    production.listWorkbenchTaskSummariesByOrderItemIds(active.map(item => String(item._id || item.id)), context),
    Promise.all(active.map(item => vendor.getByOrderItemId(item._id || item.id))),
  ]);
  // Existing production/vendor work must be reconciled by an operator, never silently cancelled.
  if (tasks.length || submissions.some(Boolean) || active.some(item => !cancellableStatuses.has(item.status))) {
    await createReviewCase(order, context, 'Etsy cancellation arrived after fulfillment work had started.');
    throw reviewError(order);
  }
  const { cancelOrderItem } = require('./orderItemCancel.service');
  for (const item of active) {
    await cancelOrderItem(item._id || item.id, { reason: 'Etsy confirmed full cancellation' }, context);
  }
  return true;
}

module.exports = { isBlocked, assertCanFulfill, reconcile };
