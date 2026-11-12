const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const status = require('./orderItemStatusTransition.service');
const orderAccess = require('./orderAccess.service');
const workbench = require('./orderWorkbenchProjection.service');
const { orderItemStatuses } = require('../constants/orderStatuses');

const vendorSubmission = require('../../vendorSubmission/public');
const production = require('../../production/public');
const mapping = require('../../mapping/public');
const shipment = require('../../shipment/public');

function conflict(message, details) { return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, details); }

async function recoverForVendorRematch(orderItemId, payload = {}, authContext = {}) {
  const item = await orderItemRepository.findById(orderItemId);
  const order = item && await orderRepository.findById(item.orderId);
  if (!item || !order) throw new AppError('Order item not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  await orderAccess.assertCanWriteOrder(order, authContext);
  if (!payload.externalCancellationConfirmed) throw new AppError('External vendor cancellation must be confirmed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  const submission = await vendorSubmission.getByOrderItemId(orderItemId);
  if (!submission || !['SUBMITTED', 'CANCELLED'].includes(submission.status)) throw conflict('Only submitted or externally cancelled vendor orders can be reset for rematch', { status: submission?.status || null });
  const currentShipment = await shipment.getShipmentByOrderItem(orderItemId);
  if (currentShipment && (currentShipment.trackingNumber || currentShipment.marketplaceConfirmationStatus !== 'PENDING')) {
    throw conflict('Cannot reset an order with tracking or marketplace confirmation');
  }
  const reason = payload.reason;
  if (submission.status === 'SUBMITTED') {
    await vendorSubmission.cancelAfterExternalCancellation(submission.id, { cancelReason: reason }, authContext);
    if (currentShipment) await shipment.updateStatus(currentShipment.id, { status: 'CANCELLED', note: reason }, authContext);
  }
  await production.cancelTaskAfterExternalVendorCancellation(orderItemId, { reason }, authContext);
  await mapping.resetFulfillmentPlanForVendorRematch(orderItemId, authContext);
  const updated = await status.transitionItemStatus(orderItemId, orderItemStatuses.MAPPING_PENDING, { ...authContext, source: 'MAPPING', allowVendorRematchRecovery: true });
  await workbench.rebuildOrderWorkbenchProjection(updated.orderId, authContext, { source: 'VENDOR_REMATCH_RECOVERY' });
  return updated;
}

module.exports = { recoverForVendorRematch };
