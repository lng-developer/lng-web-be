const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const notificationPublic = require('../../notification/public');
const orderRepository = require('../repositories/order.repository');
const orderAccess = require('./orderAccess.service');

function notFound() {
  return new AppError('Order not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function assignStaff(orderId, assignedStaffId, authContext = {}) {
  assertValidObjectId(orderId, 'orderId');
  if (assignedStaffId) assertValidObjectId(assignedStaffId, 'assignedStaffId');

  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound();

  orderAccess.assertCanWriteShop(order.shopId, authContext);

  const updated = await orderRepository.updateAssignedStaff(orderId, assignedStaffId || null);
  if (!updated) throw notFound();

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
