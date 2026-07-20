const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const orderPublic = require('../../order/public');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { shipmentPermissions, shipmentStatuses } = require('../constants/shipment.constants');
const repository = require('../repositories/shipment.repository');
const { getTrackingAdapter } = require('./vendorTrackingAdapterRegistry.service');
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

function isDeliveredVendorStatus(status) {
  return String(status || '').trim().toLowerCase() === 'delivered';
}

function asDateOrNull(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
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

function scopedShopIds(authContext = {}, permission) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(permission)
    ))
    .map((scope) => String(scope.scopeId)))];
}

function scopedReadQuery(query = {}, authContext = {}) {
  if (authContext?.system) return query;
  if (query.shopId) {
    assertCanAccessShop(query.shopId, shipmentPermissions.READ, authContext);
    return query;
  }
  if (hasPermission(authContext, shipmentPermissions.READ)) return query;
  const shopIds = scopedShopIds(authContext, shipmentPermissions.READ);
  return shopIds.length ? { ...query, shopIds } : null;
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
  const activeItemIds = items
    .filter((item) => item.status !== 'CANCELLED')
    .map((item) => String(item._id || item.id))
    .filter(Boolean);
  if (activeItemIds.length === 0) return;

  const shipments = await repository.listByOrderItemIds(activeItemIds);
  const shipmentByItemId = new Map(shipments.map((entry) => [String(entry.orderItemId), entry]));
  const allDelivered = activeItemIds.every((orderItemId) => (
    shipmentByItemId.get(orderItemId)?.status === shipmentStatuses.DELIVERED
  ));

  if (allDelivered) {
    await orderPublic.markOrderDelivered(shipment.orderId, deliveredAt, { source: 'SHIPMENT' });
  }
}

async function listShipments(query = {}, authContext) {
  const scopedQuery = authContext ? scopedReadQuery(query, authContext) : query;
  if (!scopedQuery) {
    return toPaginatedResponse({
      items: [],
      total: 0,
      page: query.page || 1,
      limit: query.limit || 20,
    });
  }
  return toPaginatedResponse(await repository.list(scopedQuery));
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
    provider: submission.provider || null,
    externalOrderId: submission.externalOrderId || null,
    vendorExternalOrderId: submission.vendorExternalOrderId || null,
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
  if (shipment.status === shipmentStatuses.DELIVERED) {
    if (shipment.carrier === carrier && shipment.trackingNumber === trackingNumber) {
      return toShipmentDto(shipment);
    }
    throw conflict('Delivered shipment tracking cannot be changed', { status: shipment.status });
  }
  if (
    shipment.status === shipmentStatuses.SHIPPED
    && shipment.carrier === carrier
    && shipment.trackingNumber === trackingNumber
  ) {
    return toShipmentDto(shipment);
  }
  const shippedAt = shipment.shippedAt || new Date();
  const updated = await repository.updateTrackingIfNotDelivered(shipmentId, {
    carrier,
    trackingNumber,
    trackingUrl: payload.trackingUrl ? String(payload.trackingUrl).trim() : null,
    note: payload.note ? String(payload.note).trim() : null,
    status: shipmentStatuses.SHIPPED,
    shippedAt,
  });
  if (!updated) {
    const current = await repository.findById(shipmentId);
    if (!current) throw notFound('Shipment not found');
    if (
      current.status === shipmentStatuses.DELIVERED
      && current.carrier === carrier
      && current.trackingNumber === trackingNumber
    ) {
      return toShipmentDto(current);
    }
    throw conflict('Shipment tracking cannot be changed', { status: current.status });
  }
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
  if (shipment.status === shipmentStatuses.DELIVERED) {
    if (status === shipmentStatuses.DELIVERED) return toShipmentDto(shipment);
    throw conflict('Delivered shipment status cannot be changed', { status: shipment.status });
  }
  if (status === shipmentStatuses.DELIVERED && shipment.status !== shipmentStatuses.SHIPPED) {
    throw conflict('Shipment must be shipped before it can be delivered', { status: shipment.status });
  }

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

async function fetchVendorTracking(provider, externalOrderId, options = {}) {
  const adapter = getTrackingAdapter(provider);
  if (!adapter || typeof adapter.fetchTrackingByExternalOrderId !== 'function') {
    throw validationError('Unsupported vendor tracking provider', { provider });
  }

  try {
    return await adapter.fetchTrackingByExternalOrderId(externalOrderId, options);
  } catch (error) {
    throw conflict('Vendor tracking request failed', {
      provider,
      statusCode: error.vendorHttpStatus || null,
      message: error.vendorMessage || error.message,
    });
  }
}

async function recheckVendorTracking(payload = {}, authContext) {
  const provider = String(payload.provider || '').trim().toUpperCase();
  const externalOrderId = String(payload.externalOrderId || '').trim();
  if (payload.vendorSubmissionId) {
    assertValidObjectId(payload.vendorSubmissionId, 'vendorSubmissionId');
    const submission = await vendorSubmissionPublic.getById(payload.vendorSubmissionId);
    if (!submission) throw notFound('Vendor submission not found');
    assertCanAccessShop(submission.shopId, shipmentPermissions.WRITE, authContext);
  } else {
    if (
      authContext
      && !authContext.system
      && !hasPermission(authContext, shipmentPermissions.WRITE)
    ) {
      throw forbidden();
    }
  }
  const tracking = await fetchVendorTracking(provider, externalOrderId, {
    dateFrom: asDateOrNull(payload.dateFrom),
    dateTo: asDateOrNull(payload.dateTo),
  });

  if (!payload.vendorSubmissionId) {
    return {
      provider,
      externalOrderId,
      applied: false,
      tracking,
    };
  }

  const created = await createFromVendorSubmission(payload.vendorSubmissionId, authContext);
  if (!tracking.trackingNumber) {
    return {
      provider,
      externalOrderId,
      vendorSubmissionId: payload.vendorSubmissionId,
      applied: false,
      reason: 'TRACKING_NOT_FOUND',
      tracking,
      shipment: created,
    };
  }

  let shipment = await updateTracking(created.id, {
    carrier: tracking.carrier || provider,
    trackingNumber: tracking.trackingNumber,
    trackingUrl: tracking.trackingUrl || null,
    note: `Vendor tracking recheck: ${provider}`,
  }, authContext);

  if (isDeliveredVendorStatus(tracking.vendorStatus)) {
    shipment = await updateStatus(shipment.id, { status: shipmentStatuses.DELIVERED }, authContext);
  }

  return {
    provider,
    externalOrderId,
    vendorSubmissionId: payload.vendorSubmissionId,
    applied: true,
    tracking,
    shipment,
  };
}

function compactBatchError(error) {
  return {
    errorCode: error?.code || errorCodes.INTERNAL_SERVER_ERROR,
    reason: error?.message || 'Tracking recheck failed',
  };
}

function shouldSkipShipment(shipment) {
  return shipment?.status === shipmentStatuses.DELIVERED;
}

async function recheckSubmittedVendorTracking(query = {}, authContext) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const listQuery = {
    provider: query.provider ? String(query.provider).trim().toUpperCase() : undefined,
    limit,
  };
  if (query.shopId) {
    assertCanAccessShop(query.shopId, shipmentPermissions.WRITE, authContext);
    listQuery.shopId = query.shopId;
  } else if (!authContext?.system && !hasPermission(authContext, shipmentPermissions.WRITE)) {
    const shopIds = scopedShopIds(authContext, shipmentPermissions.WRITE);
    if (!shopIds.length) {
      return { checked: 0, applied: 0, skipped: 0, failed: 0, items: [] };
    }
    listQuery.shopIds = shopIds;
  }

  const submissions = await vendorSubmissionPublic.listSubmittedForTracking(listQuery, {
    ...(authContext || {}),
    system: true,
    source: authContext?.source || 'SHIPMENT_TRACKING_RECHECK_BATCH',
  });

  const items = [];
  for (const submission of submissions) {
    const base = {
      vendorSubmissionId: submission.id,
      provider: submission.provider,
      externalOrderId: submission.vendorExternalOrderId,
    };

    if (!submission.provider || !submission.vendorExternalOrderId) {
      items.push({ ...base, status: 'SKIPPED', reason: 'MISSING_VENDOR_TRACKING_REF' });
      continue;
    }

    const existingShipment = await repository.findByOrderItem(submission.orderItemId);
    if (shouldSkipShipment(existingShipment)) {
      items.push({ ...base, status: 'SKIPPED', reason: 'SHIPMENT_DELIVERED' });
      continue;
    }

    try {
      const result = await recheckVendorTracking({
        provider: submission.provider,
        externalOrderId: submission.vendorExternalOrderId,
        vendorSubmissionId: submission.id,
      }, {
        ...(authContext || {}),
        system: authContext?.system || false,
        source: authContext?.source || 'SHIPMENT_TRACKING_RECHECK_BATCH',
      });
      items.push({
        ...base,
        status: result.applied ? 'APPLIED' : 'SKIPPED',
        reason: result.reason || null,
        shipmentId: result.shipment?.id || null,
        trackingNumber: result.tracking?.trackingNumber || null,
      });
    } catch (error) {
      items.push({
        ...base,
        status: 'FAILED',
        ...compactBatchError(error),
      });
    }
  }

  return {
    checked: submissions.length,
    applied: items.filter((item) => item.status === 'APPLIED').length,
    skipped: items.filter((item) => item.status === 'SKIPPED').length,
    failed: items.filter((item) => item.status === 'FAILED').length,
    items,
  };
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

async function summarizeShipments(query = {}, authContext) {
  const scopedQuery = scopedReadQuery(query, authContext);
  if (!scopedQuery) {
    return {
      total: 0,
      trackingPending: 0,
      shipped: 0,
      delivered: 0,
      exception: 0,
      cancelled: 0,
      byStatus: {},
      byCarrier: [],
    };
  }
  const summary = await repository.summarize(scopedQuery);
  return {
    total: summary.total || 0,
    trackingPending: summary.byStatus?.[shipmentStatuses.TRACKING_PENDING] || 0,
    shipped: summary.byStatus?.[shipmentStatuses.SHIPPED] || 0,
    delivered: summary.byStatus?.[shipmentStatuses.DELIVERED] || 0,
    exception: summary.byStatus?.[shipmentStatuses.EXCEPTION] || 0,
    cancelled: summary.byStatus?.[shipmentStatuses.CANCELLED] || 0,
    byStatus: summary.byStatus || {},
    byCarrier: summary.byCarrier || [],
  };
}

async function summarizeShippedByOrderItemIds(orderItemIds = []) {
  const uniqueIds = [...new Set(orderItemIds.map(String).filter(Boolean))];
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  return repository.summarizeShippedByOrderItemIds(uniqueIds);
}

module.exports = {
  createFromVendorSubmission,
  getShipment,
  getShipmentByOrderItem,
  listShipments,
  listSummariesByOrderItemIds,
  recheckSubmittedVendorTracking,
  recheckVendorTracking,
  summarizeShippedByOrderItemIds,
  summarizeShipments,
  updateStatus,
  updateTracking,
};
