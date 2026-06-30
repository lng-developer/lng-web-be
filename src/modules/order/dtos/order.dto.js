function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function toPagination(result = {}) {
  return {
    total: result.total,
    page: result.page,
    limit: result.limit,
  };
}

function toOrderDto(order) {
  if (!order) {
    return null;
  }

  return {
    id: toId(order._id || order.id),
    shopId: toId(order.shopId),
    shopConnectionId: toId(order.shopConnectionId),
    salesChannelCode: order.salesChannelCode,
    marketplaceCode: order.marketplaceCode,
    externalOrderId: order.externalOrderId,
    externalStatus: order.externalStatus,
    importSources: order.importSources || [],
    orderedAt: order.orderedAt,
    shipByDate: order.shipByDate,
    deliveredByDate: order.deliveredByDate,
    buyer: order.buyer || {},
    shippingAddress: order.shippingAddress || {},
    shippingService: order.shippingService || {},
    addressValidationStatus: order.addressValidationStatus,
    status: order.status,
    externalData: order.externalData || {},
    importedAt: order.importedAt,
    lastImportedAt: order.lastImportedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function toOrderListDto(order) {
  return toOrderDto(order);
}

function toPaginatedOrderDto(result = {}) {
  return {
    items: (result.items || []).map(toOrderListDto),
    pagination: toPagination(result),
  };
}

module.exports = {
  toOrderDto,
  toOrderListDto,
  toPaginatedOrderDto,
};
