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

function toExpandedItemPricing(item = {}, fulfillmentPlan = null) {
  const price = item.price || {};
  const costEstimate = fulfillmentPlan && fulfillmentPlan.costEstimate ? fulfillmentPlan.costEstimate : null;
  const baseCostAmount = getCostEstimateLineAmount(costEstimate, 'BASE_COST');
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
    baseCostAmount,
    totalCostAmount: costEstimate ? costEstimate.totalAmount : null,
    baseCostStatus: baseCostAmount !== null ? 'PRESENT' : 'MISSING',
    costEstimate,
  };
}

function getCostEstimateLineAmount(costEstimate = null, code) {
  const line = (costEstimate?.lines || []).find((entry) => entry.code === code);
  return line && Number.isFinite(Number(line.amount)) ? Number(line.amount) : null;
}

function toCompactListing(listing = null) {
  if (!listing) return null;
  return {
    id: toId(listing._id || listing.id),
    sku: listing.sku || null,
    asin: listing.asin || null,
    etsyListingId: listing.etsyListingId || null,
    title: listing.title || null,
    psdTemplateAssetId: toId(listing.psdTemplateAssetId),
    psdStatus: listing.psdStatus || null,
    costCenterStatus: listing.costCenterStatus || null,
    productTypeGroup: listing.productTypeGroupId ? {
      id: toId(listing.productTypeGroupId),
      code: listing.productTypeGroupId.code || null,
      name: listing.productTypeGroupId.name || null,
      status: listing.productTypeGroupId.status || null,
    } : null,
    internalTemplate: listing.internalTemplateId ? {
      id: toId(listing.internalTemplateId),
      code: listing.internalTemplateId.code || null,
      name: listing.internalTemplateId.name || null,
      status: listing.internalTemplateId.status || null,
    } : null,
  };
}

function toExpandedItemProduction(production = null) {
  if (!production) return null;
  return {
    taskId: toId(production.id || production.taskId),
    status: production.status || production.productionStatus || null,
    scaleStatus: production.scaleStatus || null,
    qcStatus: production.qcStatus || null,
    blockers: production.blockers || [],
    assignedDesignUserId: toId(production.assignedDesignUserId),
    scaleBy: toId(production.assignedDesignUserId),
    qcBy: toId(production.qcBy),
    assignedAt: production.assignedAt || null,
    designNote: production.designNote || null,
    designAssignmentStatus: production.designAssignmentStatus || null,
    readyAt: production.readyAt || null,
    sentToVendorAt: production.sentToVendorAt || null,
  };
}

function toWorkbenchProduction(production = null) {
  if (!production) return null;
  return {
    taskId: toId(production.id || production.taskId),
    status: production.status || production.productionStatus || null,
    scaleStatus: production.scaleStatus || null,
    qcStatus: production.qcStatus || null,
    scaleBy: toId(production.assignedDesignUserId),
    qcBy: toId(production.qcBy),
  };
}

function toWorkbenchOrder(row = {}) {
  const order = row.order || {};
  const shop = row.shop || null;
  const itemPricing = (row.items || []).map((entry) => {
    const item = entry.item || {};
    const costEstimate = entry.fulfillmentPlan?.costEstimate || null;
    return {
      customerPaidAmount: toExpandedItemPricing(item, entry.fulfillmentPlan).customerPaidAmount,
      baseCostAmount: getCostEstimateLineAmount(costEstimate, 'BASE_COST'),
      totalCostAmount: costEstimate?.totalAmount ?? null,
      currency: item.price?.currency || costEstimate?.currency || null,
    };
  });
  const sumNullable = (field) => {
    const values = itemPricing.map((pricing) => pricing[field]).filter((value) => value !== null && value !== undefined);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };

  return {
    id: toId(order._id || order.id),
    externalOrderId: order.externalOrderId,
    createdAt: order.createdAt || null,
    orderedAt: order.orderedAt || null,
    status: order.status || null,
    buyer: {
      name: order.buyer?.name || null,
    },
    customerPaidAmount: order.totalAmount || 0,
    pricing: {
      customerPaidAmount: order.totalAmount || itemPricing.reduce((total, pricing) => total + (pricing.customerPaidAmount || 0), 0),
      baseCostAmount: sumNullable('baseCostAmount'),
      totalCostAmount: sumNullable('totalCostAmount'),
      currency: order.currency || itemPricing.find((pricing) => pricing.currency)?.currency || null,
      costCenterStatus: itemPricing.length > 0 && itemPricing.every((pricing) => pricing.totalCostAmount !== null) ? 'PRESENT' : 'MISSING',
    },
    currency: order.currency || null,
    shopId: toId(order.shopId),
    shop: shop ? {
      id: toId(shop._id || shop.id),
      name: shop.name || null,
    } : null,
    assignedStaffId: toId(order.assignedStaffId),
    salesChannelCode: order.salesChannelCode || null,
    marketplaceCode: order.marketplaceCode || null,
    shippingService: order.shippingService || {},
    caseStatus: order.caseStatus || null,
  };
}

function toWorkbenchCustomization(customization = null) {
  if (!customization) return null;
  const customerInputs = customization.customerInputs || {};
  const textInputs = (customerInputs.texts || []).map((input) => ({
    type: 'TEXT',
    label: input.label || null,
    name: input.name || null,
    value: input.value || null,
  }));
  const optionInputs = (customerInputs.options || []).map((input) => ({
    type: 'OPTION',
    label: input.label || null,
    name: input.name || null,
    value: input.value || null,
  }));
  const imageInputs = (customerInputs.images || []).map((input) => ({
    type: 'IMAGE',
    label: input.label || null,
    name: input.name || null,
    assetId: toId(input.assetId),
    secureUrl: input.secureUrl || null,
    mimeType: input.mimeType || null,
  }));

  return {
    payloadId: toId(customization.payloadId),
    status: customization.status || null,
    needsReview: Boolean(customization.needsReview),
    inputs: [...textInputs, ...optionInputs, ...imageInputs],
  };
}

function toVendorSummary(vendor) {
  if (!vendor) return null;
  return {
    id: toId(vendor._id || vendor.id),
    code: vendor.code || null,
    name: vendor.name || null,
  };
}

function toWorkbenchMapping(fulfillmentPlan = null) {
  if (!fulfillmentPlan) return null;
  const vendorProduct = fulfillmentPlan.vendorProduct || null;
  const vendorCostCenter = fulfillmentPlan.vendorCostCenter || null;

  return {
    id: toId(fulfillmentPlan.id),
    status: fulfillmentPlan.status || null,
    selectionMode: fulfillmentPlan.selectionMode || null,
    vendor: toVendorSummary(vendorProduct?.vendor || vendorProduct?.vendorId),
    vendorProduct: vendorProduct ? {
      id: toId(vendorProduct.id || vendorProduct._id),
      code: vendorProduct.code || null,
      name: vendorProduct.name || null,
    } : null,
    vendorCostCenter: vendorCostCenter ? {
      id: toId(vendorCostCenter.id || vendorCostCenter._id),
      code: vendorCostCenter.code || null,
      name: vendorCostCenter.name || null,
      sku: vendorCostCenter.sku || null,
      lngCode: vendorCostCenter.lngCode || null,
      size: vendorCostCenter.standardSize || vendorCostCenter.vendorSize || null,
      color: vendorCostCenter.standardColor || vendorCostCenter.vendorColor || null,
    } : null,
  };
}

function toWorkbenchItem(row = {}) {
  const item = row.item || {};
  const fulfillmentPlan = row.fulfillmentPlan || null;

  return {
    item: {
      id: toId(item._id || item.id),
      orderId: toId(item.orderId),
      externalItemId: item.externalItemId || null,
      sku: item.sku || null,
      title: item.title || null,
      asin: item.asin || row.listing?.asin || null,
      quantity: item.quantity || 0,
      status: item.status || null,
      listingId: toId(item.listingId),
    },
    seller: row.seller ? {
      employeeCode: row.seller.employeeCode || null,
      name: row.seller.name || null,
    } : null,
    listing: toCompactListing(row.listing),
    customization: toWorkbenchCustomization(row.customization),
    mapping: toWorkbenchMapping(fulfillmentPlan),
    pricing: {
      customerPaidAmount: toExpandedItemPricing(item, fulfillmentPlan).customerPaidAmount,
      baseCostAmount: getCostEstimateLineAmount(fulfillmentPlan?.costEstimate, 'BASE_COST'),
      totalCostAmount: fulfillmentPlan?.costEstimate?.totalAmount ?? null,
      currency: item.price?.currency || fulfillmentPlan?.costEstimate?.currency || null,
    },
    production: toWorkbenchProduction(row.production),
    tracking: row.tracking || null,
  };
}

function toOrderWorkbenchDto(result = {}) {
  return {
    items: (result.items || []).map((row) => ({
      order: toWorkbenchOrder(row),
      items: (row.items || []).map(toWorkbenchItem),
    })),
    pagination: toPagination(result),
    tabCounts: result.tabCounts || {},
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
    items: (result.items || []).map(({
      item, listing, customization, fulfillmentPlan, production,
    }) => ({
      item: toExpandedOrderItem(item),
      platform: toItemPlatform(item),
      pricing: toExpandedItemPricing(item, fulfillmentPlan),
      listing: toCompactListing(listing),
      production: toExpandedItemProduction(production),
      customization: customization || null,
    })),
  };
}

module.exports = {
  toOrderDto,
  toOrderListDto,
  toPaginatedOrderDto,
  toOrderSummaryDto,
  toOrderWorkbenchDto,
  toOrderExpandedDto,
};
