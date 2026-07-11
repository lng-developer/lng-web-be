const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const orderPublic = require('../../order/public');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { shipmentPermissions, shipmentStatuses } = require('../constants/shipment.constants');
const repository = require('../repositories/shipment.repository');
const {
  toPaginatedResponse,
  toShipmentDto,
  toShipmentSummaryDto,
} = require('../dtos/shipment.dto');

const SHOP_SCOPE_TYPE = 'shop';

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict(message, details) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, details);
}

function validationError(message, details) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, details);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasPermission(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission) || (
    permission === shipmentPermissions.READ
    && permissions.includes(shipmentPermissions.WRITE)
  );
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function isDuplicateKey(error) {
  return error && error.code === 11000;
}

async function loadShipment(shipmentId) {
  assertValidObjectId(shipmentId, 'shipmentId');
  const shipment = await repository.findById(shipmentId);
  if (!shipment) throw notFound('Shipment not found');
  return shipment;
}

async function appendShipmentTimeline(shipment, eventType, authContext, metadata = {}) {
  const item = await orderPublic.findItemById(shipment.orderItemId);
  if (!item) throw notFound('Order item not found');
  await orderPublic.appendTimeline({
    orderId: shipment.orderId,
    orderItemId: shipment.orderItemId,
    shopId: shipment.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    eventType,
    source: 'SHIPMENT',
    actorId: authContext?.accountId || null,
    metadata,
  });
}

async function markOrderDeliveredWhenComplete(shipment, deliveredAt) {
  const items = await orderPublic.listItemsByOrder(shipment.orderId);
  const itemIds = items.map((item) => String(item._id || item.id)).filter(Boolean);
  if (itemIds.length === 0) return;

  const shipments = await repository.listByOrderItemIds(itemIds);
  const shipmentByItemId = new Map(shipments.map((entry) => [String(entry.orderItemId), entry]));
  const allDelivered = itemIds.every((orderItemId) => (
    shipmentByItemId.get(orderItemId)?.status === shipmentStatuses.DELIVERED
  ));

  if (allDelivered) {
    await orderPublic.markOrderDelivered(shipment.orderId, deliveredAt, { source: 'SHIPMENT' });
  }
}

async function listShipments(query = {}, authContext) {
  const result = await repository.list(query);
  if (authContext) {
    result.items.forEach((shipment) => assertCanAccessShop(shipment.shopId, shipmentPermissions.READ, authContext));
  }
  return toPaginatedResponse(result);
}

async function getShipment(shipmentId, authContext) {
  const shipment = await loadShipment(shipmentId);
  assertCanAccessShop(shipment.shopId, shipmentPermissions.READ, authContext);
  return toShipmentDto(shipment);
}

async function getShipmentByOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const shipment = await repository.findByOrderItem(orderItemId);
  if (!shipment) return null;
  assertCanAccessShop(shipment.shopId, shipmentPermissions.READ, authContext);
  return toShipmentDto(shipment);
}

async function createFromVendorSubmission(vendorSubmissionId, authContext) {
  assertValidObjectId(vendorSubmissionId, 'vendorSubmissionId');
  const submission = await vendorSubmissionPublic.getById(vendorSubmissionId);
  if (!submission) throw notFound('Vendor submission not found');
  assertCanAccessShop(submission.shopId, shipmentPermissions.WRITE, authContext);
  if (submission.status !== 'SUBMITTED') {
    throw conflict('Vendor submission is not submitted', { status: submission.status });
  }

  const existing = await repository.findActiveByVendorSubmission(vendorSubmissionId);
  if (existing) return toShipmentDto(existing);

  const payload = {
    vendorSubmissionId,
    orderId: submission.orderId,
    orderItemId: submission.orderItemId,
    shopId: submission.shopId,
    status: shipmentStatuses.TRACKING_PENDING,
  };

  try {
    const shipment = await repository.create(payload);
    await orderPublic.transitionItemStatus(submission.orderItemId, 'TRACKING_PENDING', { source: 'SHIPMENT' });
    return toShipmentDto(shipment);
  } catch (error) {
    if (isDuplicateKey(error)) {
      const duplicate = await repository.findActiveByVendorSubmission(vendorSubmissionId);
      if (duplicate) return toShipmentDto(duplicate);
      throw conflict('Shipment already exists for vendor submission');
    }
    throw error;
  }
}

async function updateTracking(shipmentId, payload = {}, authContext) {
  const carrier = String(payload.carrier || '').trim();
  const trackingNumber = String(payload.trackingNumber || '').trim();
  if (!carrier || !trackingNumber) {
    throw validationError('carrier and trackingNumber are required', {
      fields: ['carrier', 'trackingNumber'],
    });
  }

  const shipment = await loadShipment(shipmentId);
  assertCanAccessShop(shipment.shopId, shipmentPermissions.WRITE, authContext);
  const shippedAt = shipment.shippedAt || new Date();
  const updated = await repository.updateById(shipmentId, {
    carrier,
    trackingNumber,
    trackingUrl: payload.trackingUrl ? String(payload.trackingUrl).trim() : null,
    note: payload.note ? String(payload.note).trim() : null,
    status: shipmentStatuses.SHIPPED,
    shippedAt,
  });
  await orderPublic.transitionItemStatus(shipment.orderItemId, 'SHIPPED', { source: 'SHIPMENT' });
  await appendShipmentTimeline(updated, 'TRACKING_AVAILABLE', authContext, {
    carrier,
    trackingNumber,
  });
  return toShipmentDto(updated);
}

async function updateStatus(shipmentId, payload = {}, authContext) {
  const status = String(payload.status || '').trim().toUpperCase();
  if (![shipmentStatuses.DELIVERED, shipmentStatuses.EXCEPTION, shipmentStatuses.CANCELLED].includes(status)) {
    throw validationError('Invalid shipment status', { status });
  }
  const shipment = await loadShipment(shipmentId);
  assertCanAccessShop(shipment.shopId, shipmentPermissions.WRITE, authContext);

  const patch = {
    status,
    note: Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note || null : shipment.note || null,
  };
  if (status === shipmentStatuses.DELIVERED) {
    patch.deliveredAt = shipment.deliveredAt || new Date();
  }
  const updated = await repository.updateById(shipmentId, patch);
  if (status === shipmentStatuses.DELIVERED) {
    await markOrderDeliveredWhenComplete(updated, patch.deliveredAt);
    await appendShipmentTimeline(updated, 'SHIPMENT_CONFIRMED', authContext);
  }
  return toShipmentDto(updated);
}

async function listSummariesByOrderItemIds(orderItemIds = [], authContext) {
  const uniqueIds = [...new Set(orderItemIds.map(String).filter(Boolean))];
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  const shipments = await repository.listByOrderItemIds(uniqueIds);
  if (authContext) {
    shipments.forEach((shipment) => assertCanAccessShop(shipment.shopId, shipmentPermissions.READ, authContext));
  }
  return shipments.map(toShipmentSummaryDto);
}

module.exports = {
  createFromVendorSubmission,
  getShipment,
  getShipmentByOrderItem,
  listShipments,
  listSummariesByOrderItemIds,
  updateStatus,
  updateTracking,
};
