const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { orderItemStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderItemStatusTransitionService = require('./orderItemStatusTransition.service');
const orderTimelineService = require('./orderTimeline.service');
const orderAccess = require('./orderAccess.service');
const { recordOrderOperation } = require('./orderOperationAudit.service');

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function cancelOrderItem(orderItemId, payload = {}, authContext = {}) {
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');
  orderAccess.assertCanWriteShop(item.shopId, authContext);

  const submission = await vendorSubmissionPublic.getByOrderItemId(orderItemId);
  if (submission?.status === 'SUBMITTED') {
    throw new AppError('Submitted vendor order cannot be cancelled', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, {
      orderItemId,
      vendorSubmissionId: submission.id,
      status: submission.status,
    });
  }

  const updated = await orderItemStatusTransitionService.transitionItemStatus(
    orderItemId,
    orderItemStatuses.CANCELLED,
    { ...authContext, source: orderTimelineSources.USER },
  );

  await orderTimelineService.appendTimeline({
    orderId: item.orderId,
    orderItemId,
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    eventType: orderTimelineEventTypes.ORDER_ITEM_CANCELLED,
    source: orderTimelineSources.USER,
    actorId: authContext.accountId || null,
    metadata: {
      reason: payload.reason,
      previousStatus: item.status || null,
    },
  });
  await recordOrderOperation({
    action: 'ORDER_ITEM_CANCELLED', entityType: 'ORDER_ITEM', entityId: orderItemId,
    shopId: item.shopId, authContext,
    changes: { status: { from: item.status || null, to: orderItemStatuses.CANCELLED } },
    metadata: { reasonProvided: Boolean(payload.reason) },
  });

  return updated;
}

module.exports = {
  cancelOrderItem,
};
