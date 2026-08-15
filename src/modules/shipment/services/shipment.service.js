const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const crypto = require('crypto');
const notificationPublic = require('../../notification/public');
const orderPublic = require('../../order/public');
const vendorPublic = require('../../vendor/public');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { shipmentPermissions, shipmentStatuses } = require('../constants/shipment.constants');
const repository = require('../repositories/shipment.repository');
const { getTrackingAdapter } = require('./vendorTrackingAdapterRegistry.service');
const { normalizeShipmentStatus } = require('./vendorTrackingNormalizer.service');
const {
  assertMatchingTrackingIdentity,
  deriveTrackingIdentity,
} = require('./shipmentIdentity.service');
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

const statusTransitions = Object.freeze({
  [shipmentStatuses.TRACKING_PENDING]: new Set([
    shipmentStatuses.SHIPPED,
    shipmentStatuses.CANCELLED,
  ]),
  [shipmentStatuses.SHIPPED]: new Set([
    shipmentStatuses.DELIVERED,
    shipmentStatuses.EXCEPTION,
    shipmentStatuses.RETURNED,
    shipmentStatuses.CANCELLED,
  ]),
  [shipmentStatuses.EXCEPTION]: new Set([
    shipmentStatuses.RETURNED,
    shipmentStatuses.CANCELLED,
  ]),
});

const terminalShipmentStatuses = new Set([
  shipmentStatuses.DELIVERED,
  shipmentStatuses.RETURNED,
  shipmentStatuses.CANCELLED,
]);

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

function auditSource(authContext = {}) {
  if (authContext.import) return 'IMPORT';
  if (authContext.worker) return 'WORKER';
  if (['HTTP', 'WORKER', 'SYSTEM', 'IMPORT'].includes(authContext.source)) return authContext.source;
  if (authContext.system) return 'SYSTEM';
  return 'HTTP';
}

function auditActor(authContext = {}) {
  const internal = authContext.system || authContext.worker || authContext.import;
  return {
    actorType: internal ? 'SYSTEM' : (authContext.accountId ? 'ACCOUNT' : 'SYSTEM'),
    actorAccountId: internal ? null : (authContext.accountId || null),
  };
}

function auditMutationIdentity(entity = {}, authContext = {}) {
  const persistedTimestamp = entity.updatedAt
    || entity.createdAt
    || entity.shippedAt
    || entity.deliveredAt
    || entity.returnedAt
    || entity.cancelledAt;
  const internal = authContext.system || authContext.worker || authContext.import;
  const trustedOperationId = internal ? authContext.operationId : null;
  const material = Number.isInteger(entity.__v)
    ? `persisted-version:${entity.__v}`
    : persistedTimestamp
      ? `persisted-time:${new Date(persistedTimestamp).toISOString()}`
    : trustedOperationId
      ? `operation:${trustedOperationId}`
      : `persisted-state:${entity.status || 'unknown'}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function auditReasonProvided(value) {
  return Boolean(String(value || '').trim());
}

async function recordShipmentOperation({ action, shipment, authContext = {}, changes = null, metadata = {} }) {
  const entityId = String(shipment._id || shipment.id);
  try {
    await auditPublic.record({
      ...auditActor(authContext),
      actorSnapshot: {},
      action,
      entityType: 'SHIPMENT',
      entityId,
      scopeType: 'SHOP',
      scopeId: String(shipment.shopId),
      outcome: 'SUCCEEDED',
      source: auditSource(authContext),
      requestId: authContext.auditContext?.requestId || null,
      ipAddress: authContext.auditContext?.ipAddress || null,
      userAgent: authContext.auditContext?.userAgent || null,
      changes,
      metadata,
      deduplicationKey: `operations:${action.toLowerCase()}:${entityId}:${auditMutationIdentity(shipment, authContext)}`,
    }, {});
  } catch (error) {
    logger.warn('shipment_audit_write_failed', { action, entityId, error });
  }
}

async function loadShipment(shipmentId) {
  assertValidObjectId(shipmentId, 'shipmentId');
  const shipment = await repository.findById(shipmentId);
  if (!shipment) throw notFound('Shipment not found');
  return shipment;
}

async function notifyOrderOwnerOfException(shipment) {
  const shipmentId = String(shipment._id || shipment.id);
  try {
    const order = await orderPublic.findById(shipment.orderId);
    if (!order?.assignedStaffId) return;
    const recipientAccountId = String(order.assignedStaffId);
    const version = shipment.updatedAt ? new Date(shipment.updatedAt).toISOString() : 'unknown';
    await notificationPublic.notify({
      recipientAccountId,
      type: 'SHIPMENT_EXCEPTION',
      title: 'Shipment exception',
      message: 'A shipment for your order has an exception and needs attention.',
      relatedResource: { type: 'shipment', id: shipmentId },
      deduplicationKey: `SHIPMENT_EXCEPTION:${shipmentId}:${recipientAccountId}:${version}`,
    });
  } catch (error) {
    logger.warn('shipment_notification_failed', {
      shipmentId,
      errorCode: error.code || errorCodes.INTERNAL_SERVER_ERROR,
    });
  }
}

async function appendShipmentTimeline(shipment, eventType, authContext, metadata = {}, idempotencyKey = null) {
  const item = await orderPublic.findItemById(shipment.orderItemId);
  if (!item) throw notFound('Order item not found');
  const timeline = {
    orderId: shipment.orderId,
    orderItemId: shipment.orderItemId,
    shopId: shipment.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    eventType,
    source: 'SHIPMENT',
    actorId: authContext?.accountId || null,
    metadata,
  };
  if (idempotencyKey) {
    return orderPublic.appendTimelineOnce({ ...timeline, idempotencyKey });
  }
  return orderPublic.appendTimeline(timeline);
}

async function repairTrackingSideEffects(shipment, carrier, trackingNumber, authContext) {
  await orderPublic.transitionItemStatus(shipment.orderItemId, 'SHIPPED', { source: 'SHIPMENT' });
  return appendShipmentTimeline(
    shipment,
    'TRACKING_AVAILABLE',
    authContext,
    { carrier, trackingNumber },
    `SHIPMENT_TRACKING_AVAILABLE:${shipment._id || shipment.id}:${trackingNumber}`,
  );
}

async function repairTrackingPendingTransition(shipment) {
  if (shipment.status === shipmentStatuses.TRACKING_PENDING) {
    await orderPublic.transitionItemStatus(shipment.orderItemId, 'TRACKING_PENDING', { source: 'SHIPMENT' });
  }
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

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

async function exportShipmentsCsv(query = {}, authContext) {
  const result = await listShipments({ ...query, page: 1, limit: query.limit || 5000 }, authContext);
  return csvRows([
    [
      'Shipment ID', 'Order ID', 'Order item ID', 'External order ID', 'Provider',
      'Vendor order ID', 'Carrier', 'Tracking number', 'Tracking URL', 'Status',
      'Shipped at', 'Delivered at', 'Note', 'Updated at',
    ],
    ...result.items.map((shipment) => [
      shipment.id,
      shipment.orderId,
      shipment.orderItemId,
      shipment.externalOrderId,
      shipment.provider,
      shipment.vendorExternalOrderId,
      shipment.carrier,
      shipment.trackingNumber,
      shipment.trackingUrl,
      shipment.status,
      shipment.shippedAt,
      shipment.deliveredAt,
      shipment.note,
      shipment.updatedAt,
    ]),
  ]);
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
  if (existing) {
    await repairTrackingPendingTransition(existing);
    return toShipmentDto(existing);
  }

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
    await recordShipmentOperation({
      action: 'SHIPMENT_CREATED', shipment, authContext,
      metadata: { vendorSubmissionId: String(vendorSubmissionId), provider: shipment.provider || null },
    });
    await repairTrackingPendingTransition(shipment);
    return toShipmentDto(shipment);
  } catch (error) {
    if (isDuplicateKey(error)) {
      const duplicate = await repository.findActiveByVendorSubmission(vendorSubmissionId);
      if (duplicate) {
        await repairTrackingPendingTransition(duplicate);
        return toShipmentDto(duplicate);
      }
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
  if (shipment.status === shipmentStatuses.RETURNED) {
    if (shipment.carrier === carrier && shipment.trackingNumber === trackingNumber) {
      return toShipmentDto(shipment);
    }
    throw conflict('Returned shipment tracking cannot be changed', { status: shipment.status });
  }
  if (shipment.status === shipmentStatuses.DELIVERED) {
    if (shipment.carrier === carrier && shipment.trackingNumber === trackingNumber) {
      await repairTrackingSideEffects(shipment, carrier, trackingNumber, authContext);
      return toShipmentDto(shipment);
    }
    throw conflict('Delivered shipment tracking cannot be changed', { status: shipment.status });
  }
  if (shipment.status === shipmentStatuses.CANCELLED) {
    throw conflict('Cancelled shipment tracking cannot be changed', { status: shipment.status });
  }
  if (
    shipment.status === shipmentStatuses.SHIPPED
    && shipment.carrier === carrier
    && shipment.trackingNumber === trackingNumber
  ) {
    await repairTrackingSideEffects(shipment, carrier, trackingNumber, authContext);
    return toShipmentDto(shipment);
  }
  if (shipment.status === shipmentStatuses.EXCEPTION) {
    throw conflict('Exception shipment tracking cannot be changed', { status: shipment.status });
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
      current.status === shipmentStatuses.RETURNED
      && current.carrier === carrier
      && current.trackingNumber === trackingNumber
    ) {
      return toShipmentDto(current);
    }
    if (
      current.status === shipmentStatuses.DELIVERED
      && current.carrier === carrier
      && current.trackingNumber === trackingNumber
    ) {
      await repairTrackingSideEffects(current, carrier, trackingNumber, authContext);
      return toShipmentDto(current);
    }
    throw conflict('Shipment tracking cannot be changed', { status: current.status });
  }
  await recordShipmentOperation({
    action: 'SHIPMENT_TRACKING_UPDATED', shipment: updated, authContext,
    changes: { status: { from: shipment.status, to: shipmentStatuses.SHIPPED } },
    metadata: { carrier },
  });
  await repairTrackingSideEffects(updated, carrier, trackingNumber, authContext);
  return toShipmentDto(updated);
}

async function updateStatus(shipmentId, payload = {}, authContext) {
  const status = String(payload.status || '').trim().toUpperCase();
  if (![
    shipmentStatuses.DELIVERED,
    shipmentStatuses.EXCEPTION,
    shipmentStatuses.RETURNED,
    shipmentStatuses.CANCELLED,
  ].includes(status)) {
    throw validationError('Invalid shipment status', { status });
  }
  const shipment = await loadShipment(shipmentId);
  assertCanAccessShop(shipment.shopId, shipmentPermissions.WRITE, authContext);
  if (status === shipment.status) return toShipmentDto(shipment);
  if (terminalShipmentStatuses.has(shipment.status)) {
    throw conflict('Terminal shipment status cannot be changed', { status: shipment.status });
  }
  if (!statusTransitions[shipment.status]?.has(status)) {
    throw conflict('Invalid shipment status transition', {
      fromStatus: shipment.status,
      toStatus: status,
    });
  }

  const patch = {
    status,
    note: Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note || null : shipment.note || null,
  };
  if (status === shipmentStatuses.DELIVERED) {
    patch.deliveredAt = shipment.deliveredAt || new Date();
  }
  const updated = await repository.updateStatusIfCurrent(shipmentId, shipment.status, patch);
  if (!updated) {
    const current = await repository.findById(shipmentId);
    if (!current) throw notFound('Shipment not found');
    if (current.status === status) return toShipmentDto(current);
    throw conflict('Shipment status cannot be changed', { status: current.status });
  }
  await recordShipmentOperation({
    action: 'SHIPMENT_STATUS_UPDATED', shipment: updated, authContext,
    changes: {
      status: { from: shipment.status, to: status },
      reasonProvided: auditReasonProvided(payload.note),
    },
  });
  if (status === shipmentStatuses.DELIVERED) {
    await markOrderDeliveredWhenComplete(updated, patch.deliveredAt);
    await appendShipmentTimeline(updated, 'SHIPMENT_CONFIRMED', authContext);
  }
  if ([shipmentStatuses.EXCEPTION, shipmentStatuses.RETURNED].includes(status)) {
    await appendShipmentTimeline(
      updated,
      status === shipmentStatuses.EXCEPTION ? 'SHIPMENT_EXCEPTION' : 'SHIPMENT_RETURNED',
      authContext,
      {},
      `SHIPMENT_STATUS:${updated._id || updated.id}:${status}`,
    );
    if (status === shipmentStatuses.EXCEPTION) {
      await notifyOrderOwnerOfException(updated);
    }
  }
  return toShipmentDto(updated);
}

async function fetchVendorTracking(identity, options = {}) {
  const { provider, vendorId, vendorExternalOrderId } = identity;
  const adapter = getTrackingAdapter(provider);
  if (!adapter || typeof adapter.fetchTrackingByExternalOrderId !== 'function') {
    throw validationError('Unsupported vendor tracking provider', { provider });
  }

  try {
    const credential = await vendorPublic.getVendorIntegrationCredential(vendorId, provider);
    if (!credential) throw validationError('Vendor tracking credentials are not configured', { provider, vendorId });
    return await adapter.fetchTrackingByExternalOrderId(vendorExternalOrderId, { ...options, credential });
  } catch (error) {
    throw conflict('Vendor tracking request failed', {
      provider,
      statusCode: error.vendorHttpStatus || null,
      message: error.vendorMessage || error.message,
    });
  }
}

async function applyTrackingUpdate(vendorSubmissionId, update = {}, authContext) {
  let existing = await repository.findActiveByVendorSubmission(vendorSubmissionId);
  const nextStatus = normalizeShipmentStatus(update.shipmentStatus);

  if (existing?.status === shipmentStatuses.CANCELLED) {
    return { applied: true, shipment: toShipmentDto(existing) };
  }

  if (nextStatus && existing) {
    if (existing.status === nextStatus) return { applied: true, shipment: toShipmentDto(existing) };
    if (terminalShipmentStatuses.has(existing.status)) {
      return { applied: true, shipment: toShipmentDto(existing) };
    }
    if (statusTransitions[existing.status]?.has(nextStatus)) {
      return {
        applied: true,
        shipment: await updateStatus(existing._id || existing.id, { status: nextStatus }, authContext),
      };
    }
  }

  if (!update.trackingNumber) {
    if (nextStatus) {
      return {
        applied: false,
        reason: 'TRACKING_NOT_FOUND',
        shipment: existing ? toShipmentDto(existing) : null,
      };
    }
    if (!existing) {
      const repaired = await createFromVendorSubmission(vendorSubmissionId, authContext);
      return { applied: false, reason: 'TRACKING_NOT_FOUND', shipment: repaired };
    }
    return { applied: false, reason: 'TRACKING_NOT_FOUND', shipment: toShipmentDto(existing) };
  }

  if (!existing) {
    existing = await createFromVendorSubmission(vendorSubmissionId, authContext);
  }
  let shipment = await updateTracking(existing._id || existing.id, {
    carrier: update.carrier || update.provider,
    trackingNumber: update.trackingNumber,
    trackingUrl: update.trackingUrl || null,
    note: update.note || null,
  }, authContext);
  if (nextStatus && nextStatus !== shipmentStatuses.SHIPPED && shipment.status !== nextStatus) {
    shipment = await updateStatus(shipment.id, { status: nextStatus }, authContext);
  }
  return { applied: true, shipment };
}

async function recheckVendorTracking(payload = {}, authContext) {
  if (!payload.vendorSubmissionId) {
    if (authContext && !authContext.system && !hasPermission(authContext, shipmentPermissions.WRITE)) {
      throw forbidden();
    }
    throw validationError('vendorSubmissionId is required');
  }
  assertValidObjectId(payload.vendorSubmissionId, 'vendorSubmissionId');
  const submission = await vendorSubmissionPublic.getById(payload.vendorSubmissionId);
  if (!submission) throw notFound('Vendor submission not found');
  assertCanAccessShop(submission.shopId, shipmentPermissions.WRITE, authContext);
  const identity = assertMatchingTrackingIdentity(deriveTrackingIdentity(submission), payload);
  const { provider, vendorExternalOrderId: externalOrderId } = identity;
  const tracking = await fetchVendorTracking(identity, {
    dateFrom: asDateOrNull(payload.dateFrom),
    dateTo: asDateOrNull(payload.dateTo),
  });
  const shipmentStatus = normalizeShipmentStatus(
    tracking.shipmentStatus || tracking.vendorStatus || tracking.rawStatus,
  );
  const normalizedTracking = { ...tracking, shipmentStatus };
  const application = await applyTrackingUpdate(payload.vendorSubmissionId, {
    ...normalizedTracking,
    provider,
    note: `Vendor tracking recheck: ${provider}`,
    source: 'POLL',
  }, authContext);

  return {
    provider,
    externalOrderId,
    vendorSubmissionId: payload.vendorSubmissionId,
    tracking: normalizedTracking,
    ...application,
  };
}

async function recheckShipment(shipmentId, authContext) {
  const shipment = await loadShipment(shipmentId);
  assertCanAccessShop(shipment.shopId, shipmentPermissions.WRITE, authContext);
  return recheckVendorTracking({ vendorSubmissionId: String(shipment.vendorSubmissionId) }, authContext);
}

function compactBatchError(error) {
  return {
    errorCode: error?.code || errorCodes.INTERNAL_SERVER_ERROR,
    reason: error?.message || 'Tracking recheck failed',
  };
}

function shouldSkipShipment(shipment) {
  return [shipmentStatuses.DELIVERED, shipmentStatuses.RETURNED, shipmentStatuses.CANCELLED].includes(shipment?.status);
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
      items.push({
        ...base,
        status: 'SKIPPED',
        reason: existingShipment.status === shipmentStatuses.RETURNED
          ? 'SHIPMENT_RETURNED'
          : existingShipment.status === shipmentStatuses.CANCELLED ? 'SHIPMENT_CANCELLED' : 'SHIPMENT_DELIVERED',
      });
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
  applyTrackingUpdate,
  createFromVendorSubmission,
  exportShipmentsCsv,
  getShipment,
  getShipmentByOrderItem,
  listShipments,
  listSummariesByOrderItemIds,
  recheckSubmittedVendorTracking,
  recheckVendorTracking,
  recheckShipment,
  summarizeShippedByOrderItemIds,
  summarizeShipments,
  updateStatus,
  updateTracking,
};
