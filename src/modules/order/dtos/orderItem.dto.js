function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function toOrderItemDto(item) {
  if (!item) {
    return null;
  }

  return {
    id: toId(item._id || item.id),
    orderId: toId(item.orderId),
    shopId: toId(item.shopId),
    shopConnectionId: toId(item.shopConnectionId),
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    externalOrderId: item.externalOrderId,
    externalItemId: item.externalItemId,
    externalProductId: item.externalProductId,
    externalListingId: item.externalListingId,
    externalVariantId: item.externalVariantId,
    asin: item.asin,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    price: item.price,
    listingId: toId(item.listingId),
    replacementOfOrderId: toId(item.replacementOfOrderId),
    replacementOfOrderItemId: toId(item.replacementOfOrderItemId),
    replacementSequence: item.replacementSequence || null,
    replacementReason: item.replacementReason || null,
    isReplacement: Boolean(item.replacementOfOrderId || item.replacementOfOrderItemId),
    externalStatus: item.externalStatus,
    status: item.status,
    csNote: item.csNote || null,
    shipByDate: item.shipByDate,
    importSources: item.importSources || [],
    importedAt: item.importedAt,
    lastImportedAt: item.lastImportedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toPaginatedOrderItemDto(result = {}) {
  return {
    items: (result.items || []).map(toOrderItemDto),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toOrderItemDto,
  toPaginatedOrderItemDto,
};
