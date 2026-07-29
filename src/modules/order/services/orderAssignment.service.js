const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const notificationPublic = require('../../notification/public');
const orderRepository = require('../repositories/order.repository');
const orderAccess = require('./orderAccess.service');
const { recordOrderOperation, withOrderOperation } = require('./orderOperationAudit.service');

function notFound() {
  return new AppError('Order not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict() {
  return new AppError('Order was changed by another request', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

async function assignStaff(orderId, assignedStaffId, authContext = {}) {
  assertValidObjectId(orderId, 'orderId');
  if (assignedStaffId) assertValidObjectId(assignedStaffId, 'assignedStaffId');

  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound();

  orderAccess.assertCanWriteShop(order.shopId, authContext);
  if (String(order.assignedStaffId || '') === String(assignedStaffId || '')) return order;

  const updated = await withOrderOperation(async (session) => {
    const updated = await orderRepository.updateAssignedStaff(orderId, assignedStaffId || null, {
      session,
      expectedUpdatedAt: order.updatedAt,
    });
    if (!updated) throw conflict();
    await recordOrderOperation({
      action: 'ORDER_ASSIGNED', entityType: 'ORDER', entityId: orderId,
      shopId: order.shopId, authContext, session,
      changes: { assignedStaffId: { from: order.assignedStaffId || null, to: assignedStaffId || null } },
    });
    return updated;
  });
  if (updated.assignedStaffId) {
    const recipientAccountId = String(updated.assignedStaffId);
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
