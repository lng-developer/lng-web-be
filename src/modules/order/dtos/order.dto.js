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
    externalAccountId: order.externalAccountId,
    assignedStaffId: toId(order.assignedStaffId),
    costCenterStatus: order.costCenterStatus,
    psdStatus: order.psdStatus,
    paymentStatus: order.paymentStatus,
    caseStatus: order.caseStatus,
    importSources: order.importSources || [],
    orderedAt: order.orderedAt,
    shipByDate: order.shipByDate,
    deliveredByDate: order.deliveredByDate,
    deliveredAt: order.deliveredAt,
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
  if (!order) {
    return null;
  }

  return {
    id: toId(order._id || order.id),
    externalOrderId: order.externalOrderId,
    orderedAt: order.orderedAt,
    buyer: order.buyer || {},
    itemsCount: order.itemsCount || 0,
    totalAmount: order.totalAmount || 0,
    customerPaidAmount: order.totalAmount || 0,
    currency: order.currency || null,
    itemsSummary: (order.itemsSummary || []).map((item) => ({
      orderItemId: toId(item.orderItemId || item._id),
      sku: item.sku || null,
      title: item.title || null,
      quantity: item.quantity || 0,
    })),
    status: order.status,
    shopId: toId(order.shopId),
    externalAccountId: order.externalAccountId || null,
    assignedStaffId: toId(order.assignedStaffId),
    salesChannelCode: order.salesChannelCode,
    marketplaceCode: order.marketplaceCode,
    costCenterStatus: order.costCenterStatus,
    psdStatus: order.psdStatus,
    paymentStatus: order.paymentStatus,
    caseStatus: order.caseStatus,
    importSources: order.importSources || [],
    lastImportedAt: order.lastImportedAt,
    deliveredAt: order.deliveredAt,
    flags: {
      missingCostCenter: order.costCenterStatus === 'MISSING' || order.costCenterStatus === null || order.costCenterStatus === undefined,
      missingPsd: order.psdStatus === 'MISSING' || order.psdStatus === null || order.psdStatus === undefined,
      awaitingPayment: order.paymentStatus === 'PENDING',
      openCase: order.caseStatus === 'OPEN',
      delivered: Boolean(order.deliveredAt),
    },
    actions: ['VIEW'],
  };
}

function toPaginatedOrderDto(result = {}) {
  return {
    items: (result.items || []).map(toOrderListDto),
    pagination: toPagination(result),
    tabCounts: result.tabCounts || {},
  };
}

function toOrderSummaryDto(result = {}) {
  return {
    tabCounts: result.tabCounts || {},
  };
}

function toBooleanFlag(value) {
  if (value === true || value === 'TRUE' || value === 'true') return true;
  if (value === false || value === 'FALSE' || value === 'false') return false;
  return null;
}

function toOrderPlatform(order = {}) {
  const amazon = order.externalData?.amazon || {};

  return {
    channel: order.salesChannelCode || null,
    marketplace: order.marketplaceCode || null,
    sellerAccountId: order.externalAccountId || null,
    flags: {
      isPrime: toBooleanFlag(amazon.isPrime),
      isBusinessOrder: toBooleanFlag(amazon.isBusinessOrder),
      isReplacementOrder: toBooleanFlag(amazon.isReplacementOrder),
      isExchangeOrder: toBooleanFlag(amazon.isExchangeOrder),
      isBuyerRequestedCancellation: toBooleanFlag(amazon.isBuyerRequestedCancellation),
    },
  };
}

function toExpandedOrderSummary(order = {}) {
  return {
    id: toId(order._id || order.id),
    shopId: toId(order.shopId),
    salesChannelCode: order.salesChannelCode,
    marketplaceCode: order.marketplaceCode,
    externalOrderId: order.externalOrderId,
    status: order.status,
    orderedAt: order.orderedAt,
    shipByDate: order.shipByDate,
    deliveredByDate: order.deliveredByDate,
    addressValidationStatus: order.addressValidationStatus,
    assignedStaffId: toId(order.assignedStaffId),
    importSources: order.importSources || [],
  };
}

function toExpandedOrderItem(item = {}) {
  return {
    id: toId(item._id || item.id),
    externalItemId: item.externalItemId,
    sku: item.sku || null,
    title: item.title || null,
    quantity: item.quantity || 0,
    status: item.status,
    listingId: toId(item.listingId),
  };
}

function toItemPlatform(item = {}) {
  const amazon = item.externalData?.amazon || {};

  return {
    channel: item.salesChannelCode || null,
    asin: item.asin || null,
    externalListingId: item.externalListingId || null,
    externalProductId: item.externalProductId || null,
    externalVariantId: item.externalVariantId || null,
    flags: {
      hasGiftMessage: Boolean(amazon.giftMessageText),
      giftWrapType: amazon.giftWrapType || null,
    },
  };
}

function toExpandedItemPricing(item = {}) {
  const price = item.price || {};
  const itemPriceAmount = price.itemPriceAmount || 0;
  const taxAmount = (price.itemTaxAmount || 0) + (price.shippingTaxAmount || 0) + (price.giftWrapTaxAmount || 0);
  const shippingAmount = price.shippingPriceAmount || 0;
  const giftWrapAmount = price.giftWrapPriceAmount || 0;
  const discountAmount = (price.itemPromotionDiscountAmount || 0) + (price.shipPromotionDiscountAmount || 0);

  return {
    currency: price.currency || null,
    itemPriceAmount,
    taxAmount,
    shippingAmount,
    giftWrapAmount,
    discountAmount,
    customerPaidAmount: itemPriceAmount + taxAmount + shippingAmount + giftWrapAmount - discountAmount,
    baseCostAmount: null,
  };
}

function toOrderExpandedDto(result = {}) {
  const order = result.order || {};

  return {
    order: toExpandedOrderSummary(order),
    platform: toOrderPlatform(order),
    buyer: order.buyer || {},
    shipping: {
      address: order.shippingAddress || {},
      service: order.shippingService || {},
    },
    items: (result.items || []).map(({ item, customization }) => ({
      item: toExpandedOrderItem(item),
      platform: toItemPlatform(item),
      pricing: toExpandedItemPricing(item),
      customization: customization || null,
    })),
  };
}

module.exports = {
  toOrderDto,
  toOrderListDto,
  toPaginatedOrderDto,
  toOrderSummaryDto,
  toOrderExpandedDto,
};
