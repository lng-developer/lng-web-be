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

module.exports = {
  toId,
  toPaginatedResponse,
  toShipmentDto,
  toShipmentSummaryDto,
};
