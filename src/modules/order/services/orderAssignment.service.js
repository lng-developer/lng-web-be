const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const orderRepository = require('../repositories/order.repository');

const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function notFound() {
  return new AppError('Order not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function assertCanWriteShop(shopId, authContext = {}) {
  if ((authContext.permissions || []).includes(ORDER_WRITE_PERMISSION)) return;

  if (!authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

async function assignStaff(orderId, assignedStaffId, authContext = {}) {
  assertValidObjectId(orderId, 'orderId');
  if (assignedStaffId) assertValidObjectId(assignedStaffId, 'assignedStaffId');

  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound();

  assertCanWriteShop(order.shopId, authContext);

  const updated = await orderRepository.updateAssignedStaff(orderId, assignedStaffId || null);
  if (!updated) throw notFound();

  return updated;
}

module.exports = {
  assignStaff,
};
