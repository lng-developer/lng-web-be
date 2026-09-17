const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const notificationPublic = require('../../notification/public');
const orderRepository = require('../repositories/order.repository');
const orderAccess = require('./orderAccess.service');
const orderWorkbenchProjectionService = require('./orderWorkbenchProjection.service');
const { recordOrderOperation, withOrderOperation } = require('./orderOperationAudit.service');

function notFound() {
  return new AppError('Order not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict() {
  return new AppError('Order was changed by another request', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

async function assignStaff(orderId, assignedStaffIds, authContext = {}) {
  assertValidObjectId(orderId, 'orderId');
  (assignedStaffIds || []).forEach((assignedStaffId) => assertValidObjectId(assignedStaffId, 'assignedStaffIds'));

  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound();

  orderAccess.assertCanWriteShop(order.shopId, authContext);
  const previousIds = (order.assignedStaffIds || []).map(String).sort();
  const nextIds = [...new Set((assignedStaffIds || []).map(String))].sort();
  if (previousIds.join(',') === nextIds.join(',')) return order;

  const updated = await withOrderOperation(async (session) => {
    const updated = await orderRepository.updateAssignedStaffIds(orderId, nextIds, {
      session,
      expectedUpdatedAt: order.updatedAt,
    });
    if (!updated) throw conflict();
    await orderWorkbenchProjectionService.updateOrderWorkbenchOrder(orderId, {
      assignedStaffIds: updated.assignedStaffIds || [],
      'order.assignedStaffIds': updated.assignedStaffIds || [],
    }, { source: 'ORDER_ASSIGNMENT', session });
    await recordOrderOperation({
      action: 'ORDER_ASSIGNED', entityType: 'ORDER', entityId: orderId,
      shopId: order.shopId, authContext, session,
      changes: { assignedStaffIds: { from: previousIds, to: nextIds } },
    });
    return updated;
  });
  for (const recipientAccountId of updated.assignedStaffIds || []) {
    const resourceId = String(updated._id || updated.id);
    const version = updated.updatedAt ? new Date(updated.updatedAt).toISOString() : 'unknown';
    await notificationPublic.notify({
      recipientAccountId,
      type: 'ORDER_ASSIGNED',
      title: 'Order assigned',
      message: 'You were assigned an order that needs processing.',
      relatedResource: { type: 'order', id: resourceId },
      deduplicationKey: `ORDER_ASSIGNED:${resourceId}:${recipientAccountId}:${version}`,
    });
  }
  return updated;
}

module.exports = {
  assignStaff,
};
