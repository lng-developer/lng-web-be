const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const orderRepository = require('../repositories/order.repository');
const orderAccess = require('./orderAccess.service');
const { recordOrderOperation, withOrderOperation } = require('./orderOperationAudit.service');

function notFound() {
  return new AppError('Order not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function assignStaff(orderId, assignedStaffId, authContext = {}) {
  assertValidObjectId(orderId, 'orderId');
  if (assignedStaffId) assertValidObjectId(assignedStaffId, 'assignedStaffId');

  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound();

  orderAccess.assertCanWriteShop(order.shopId, authContext);
  if (String(order.assignedStaffId || '') === String(assignedStaffId || '')) return order;

  return withOrderOperation(async (session) => {
    const updated = await orderRepository.updateAssignedStaff(orderId, assignedStaffId || null, { session });
    if (!updated) throw notFound();
    await recordOrderOperation({
      action: 'ORDER_ASSIGNED', entityType: 'ORDER', entityId: orderId,
      shopId: order.shopId, authContext, session,
      changes: { assignedStaffId: { from: order.assignedStaffId || null, to: assignedStaffId || null } },
    });
    return updated;
  });
}

module.exports = {
  assignStaff,
};
