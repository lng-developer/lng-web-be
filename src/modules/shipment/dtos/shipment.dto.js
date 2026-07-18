function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toShipmentDto(shipment) {
  if (!shipment) return null;
  return {
    id: toId(shipment._id || shipment.id),
    vendorSubmissionId: toId(shipment.vendorSubmissionId),
    orderId: toId(shipment.orderId),
    orderItemId: toId(shipment.orderItemId),
    shopId: toId(shipment.shopId),
    provider: shipment.provider || null,
    externalOrderId: shipment.externalOrderId || null,
    vendorExternalOrderId: shipment.vendorExternalOrderId || null,
    carrier: shipment.carrier || null,
    trackingNumber: shipment.trackingNumber || null,
    trackingUrl: shipment.trackingUrl || null,
    status: shipment.status,
    shippedAt: shipment.shippedAt || null,
    deliveredAt: shipment.deliveredAt || null,
    note: shipment.note || null,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

function toShipmentSummaryDto(shipment) {
  if (!shipment) return null;
  return {
    shipmentId: toId(shipment._id || shipment.id || shipment.shipmentId),
    orderItemId: toId(shipment.orderItemId),
    provider: shipment.provider || null,
    externalOrderId: shipment.externalOrderId || null,
    vendorExternalOrderId: shipment.vendorExternalOrderId || null,
    carrier: shipment.carrier || null,
    trackingNumber: shipment.trackingNumber || null,
    trackingUrl: shipment.trackingUrl || null,
    status: shipment.status,
    shippedAt: shipment.shippedAt || null,
    deliveredAt: shipment.deliveredAt || null,
    note: shipment.note || null,
  };
}

function toPaginatedResponse(result = {}) {
  return {
    items: (result.items || []).map(toShipmentDto),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

function toWebhookLogDto(log) {
  if (!log) return null;
  return {
    id: toId(log._id || log.id),
    provider: log.provider || null,
    outcome: log.outcome || null,
    httpStatus: log.httpStatus ?? null,
    message: log.message || '',
    vendorSubmissionId: toId(log.vendorSubmissionId),
    orderItemId: toId(log.orderItemId),
    trackingNumber: log.trackingNumber || null,
    carrier: log.carrier || null,
    vendorStatus: log.vendorStatus || null,
    request: log.request || {},
    result: log.result || null,
    createdAt: log.createdAt,
  };
}

function toWebhookLogPageDto(result = {}) {
  return {
    items: (result.items || []).map(toWebhookLogDto),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toId,
  toPaginatedResponse,
  toShipmentDto,
  toShipmentSummaryDto,
  toWebhookLogDto,
  toWebhookLogPageDto,
};
