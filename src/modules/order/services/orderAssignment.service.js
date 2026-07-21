const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
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

  return updated;
}

module.exports = {
  assignStaff,
};
