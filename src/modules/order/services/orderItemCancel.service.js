const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { orderItemStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderItemStatusTransitionService = require('./orderItemStatusTransition.service');
const orderTimelineService = require('./orderTimeline.service');
const orderAccess = require('./orderAccess.service');
const orderNotificationService = require('./orderNotification.service');
const { recordOrderOperation, withOrderOperation } = require('./orderOperationAudit.service');

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function cancelOrderItem(orderItemId, payload = {}, authContext = {}) {
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');
  const order = await orderRepository.findById(item.orderId);
  if (!order) throw notFound('Order not found');
  orderAccess.assertCanWriteOrder(order, authContext);
  if (item.status === orderItemStatuses.CANCELLED) return item;

  const submission = await vendorSubmissionPublic.getByOrderItemId(orderItemId);
  if (submission?.status === 'SUBMITTED') {
    throw new AppError('Submitted vendor order cannot be cancelled', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, {
      orderItemId,
      vendorSubmissionId: submission.id,
      status: submission.status,
    });
  }

  const updated = await withOrderOperation(async (session) => {
    const current = await orderItemRepository.findById(orderItemId, { session });
    if (!current) throw notFound('Order item not found');
    if (current.status === orderItemStatuses.CANCELLED) return current;

    const updated = await orderItemStatusTransitionService.transitionItemStatus(
      orderItemId,
      orderItemStatuses.CANCELLED,
      { ...authContext, source: orderTimelineSources.USER, session },
    );

    await orderTimelineService.appendTimeline({
      orderId: current.orderId,
      orderItemId,
      shopId: current.shopId,
      salesChannelCode: current.salesChannelCode,
      marketplaceCode: current.marketplaceCode,
      eventType: orderTimelineEventTypes.ORDER_ITEM_CANCELLED,
      source: orderTimelineSources.USER,
      actorId: authContext.accountId || null,
      metadata: {
        reason: payload.reason,
        previousStatus: current.status || null,
      },
    }, { session });
    await recordOrderOperation({
      action: 'ORDER_ITEM_CANCELLED', entityType: 'ORDER_ITEM', entityId: orderItemId,
      shopId: current.shopId, authContext, session,
      changes: { status: { from: current.status || null, to: orderItemStatuses.CANCELLED } },
      metadata: { reasonProvided: Boolean(payload.reason) },
    });

    return updated;
  });
  await orderNotificationService.notifyAssignedStaff({
    order,
    actorAccountId: authContext.accountId || null,
    type: 'ORDER_ITEM_CANCELLED',
    title: 'Order item cancelled',
    message: 'An item was cancelled on an assigned order.',
    deduplicationScope: orderItemId,
  });
  return updated;
}

module.exports = {
  cancelOrderItem,
};
