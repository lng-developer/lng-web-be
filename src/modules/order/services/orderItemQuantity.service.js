const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const logger = require('../../../shared/utils/logger');
const repository = require('../repositories/orderItem.repository');
const orderRepository = require('../repositories/order.repository');
const access = require('./orderAccess.service');
const { parseEmployeeCodeFromSku } = require('./orderImport.helpers');
const projection = require('./orderWorkbenchProjection.service');
const timeline = require('./orderTimeline.service');
const { resolveMarketplaceQuantities } = require('./orderMarketplaceQuantity.service');
const { withOrderOperation, recordOrderOperation } = require('./orderOperationAudit.service');

const EDITABLE_STATUSES = new Set([
  'NEW', 'MAPPING_PENDING', 'CUSTOMIZATION_PENDING', 'CUSTOMIZATION_PARSED',
  'FULFILLMENT_PLANNING', 'FULFILLMENT_READY', 'NEED_PRODUCTION', 'IN_PRODUCTION', 'QC_REJECTED',
]);

function conflict(message) {
  return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

async function updateQuantity(orderItemId, { quantity, expectedQuantity, reason }, authContext = {}) {
  const production = require('../../production/public');
  const mapping = require('../../mapping/public');
  const vendor = require('../../vendorSubmission/public');
  const finance = require('../../finance/public');
  const result = await withOrderOperation(async (session) => {
    const item = await repository.findById(orderItemId, { session });
    if (!item) throw new AppError('Order item not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    const order = await orderRepository.findById(item.orderId, { session });
    if (!order) throw new AppError('Order not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    await access.assertCanWriteOrder(order, authContext);
    const sellerCode = await access.personalSellerCode(authContext);
    if (sellerCode !== undefined && (!sellerCode || parseEmployeeCodeFromSku(item.sku) !== sellerCode)) {
      throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
    }
    if (!EDITABLE_STATUSES.has(item.status) || ['CANCELLED', 'REFUNDED', 'SHIPPED', 'FAILED'].includes(order.status)) {
      throw conflict('Quantity can only be edited before vendor dispatch and shipment.');
    }
    const submission = await vendor.getByOrderItemId(orderItemId);
    if (submission && submission.status !== 'CANCELLED') {
      throw conflict('Cancel or resolve the existing vendor submission before editing quantity.');
    }
    if (item.quantity !== expectedQuantity) throw conflict('Quantity changed. Refresh the order before editing again.');
    if (quantity === item.quantity) return item;
    const [{ marketplaceQuantity }] = await resolveMarketplaceQuantities([item], { session });
    const updated = await repository.updateQuantity(orderItemId, quantity, {
      session, expectedQuantity, expectedUpdatedAt: item.updatedAt, marketplaceQuantity,
    });
    if (!updated) throw conflict('Order item changed. Refresh the order before editing again.');
    await production.syncOrderItemQuantity(orderItemId, quantity, { session });
    await mapping.syncOrderItemQuantity(orderItemId, quantity, { session });
    await projection.updateOrderWorkbenchItem(item.orderId, orderItemId, { 'item.quantity': quantity }, {
      session, source: 'ORDER_ITEM_QUANTITY',
    });
    await timeline.appendTimeline({
      orderId: item.orderId, orderItemId, shopId: item.shopId,
      salesChannelCode: item.salesChannelCode, marketplaceCode: item.marketplaceCode,
      eventType: 'ORDER_ITEM_QUANTITY_UPDATED', source: 'USER', actorId: authContext.accountId || null,
      message: `Quantity changed from ${item.quantity} to ${quantity}`,
      metadata: { previousQuantity: item.quantity, quantity, reason },
    }, { session });
    await recordOrderOperation({
      action: 'ORDER_ITEM_QUANTITY_UPDATED', entityType: 'ORDER_ITEM', entityId: orderItemId,
      shopId: item.shopId, authContext, session,
      changes: { quantity: { from: item.quantity, to: quantity } }, metadata: { reason },
    });
    return updated;
  });
  try {
    await finance.recalculateOrder(String(result.orderId), { system: true });
  } catch (error) {
    logger.warn('Finance recalculation failed after quantity update', { orderItemId, error });
    throw new AppError('Quantity was saved, but finance recalculation failed. Refresh the order before retrying.',
      httpStatus.SERVICE_UNAVAILABLE, true, errorCodes.CONFLICT_ERROR, { quantitySaved: true });
  }
  return result;
}

module.exports = { updateQuantity };
