const { deriveOrderItemWorkflow } = require('../services/orderWorkflow.service');

function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function toRefId(value) {
  if (value === undefined || value === null) return null;
  return toId(value._id || value.id || value);
}

function toCompactRef(value) {
  if (!value) return null;
  if (typeof value === 'object' && (value.code || value.name || value.status)) {
    return {
      id: toRefId(value),
      code: value.code || null,
      name: value.name || null,
      status: value.status || null,
    };
  }
  return {
    id: toRefId(value),
    code: null,
    name: null,
    status: null,
  };
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
    assignedStaffIds: (order.assignedStaffIds || []).map(toId).filter(Boolean),
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
    replacementOfOrderId: toId(order.replacementOfOrderId),
    replacementOfOrderItemId: toId(order.replacementOfOrderItemId),
    replacementSequence: order.replacementSequence || null,
    replacementReason: order.replacementReason || null,
    isReplacement: Boolean(order.replacementOfOrderId || order.replacementOfOrderItemId),
    addressValidationStatus: order.addressValidationStatus,
    status: order.status,
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
    currency: order.currency || null,
    replacementOfOrderId: toId(order.replacementOfOrderId),
    replacementOfOrderItemId: toId(order.replacementOfOrderItemId),
    replacementSequence: order.replacementSequence || null,
    replacementReason: order.replacementReason || null,
    isReplacement: Boolean(order.replacementOfOrderId || order.replacementOfOrderItemId),
    itemsSummary: (order.itemsSummary || []).map((item) => ({
      orderItemId: toId(item.orderItemId || item._id),
      sku: item.sku || null,
      title: item.title || null,
      quantity: item.quantity || 0,
      replacementOfOrderId: toId(item.replacementOfOrderId),
      replacementOfOrderItemId: toId(item.replacementOfOrderItemId),
      replacementSequence: item.replacementSequence || null,
      replacementReason: item.replacementReason || null,
      isReplacement: Boolean(item.replacementOfOrderId || item.replacementOfOrderItemId),
    })),
    status: order.status,
    shopId: toId(order.shopId),
    salesChannelCode: order.salesChannelCode,
    marketplaceCode: order.marketplaceCode,
    costCenterStatus: order.costCenterStatus,
    psdStatus: order.psdStatus,
    paymentStatus: order.paymentStatus,
    caseStatus: order.caseStatus,
    deliveredAt: order.deliveredAt,
    flags: {
      missingCostCenter: order.costCenterStatus === 'MISSING' || order.costCenterStatus === null || order.costCenterStatus === undefined,
      missingPsd: order.psdStatus === 'MISSING' || order.psdStatus === null || order.psdStatus === undefined,
      awaitingPayment: order.paymentStatus === 'PENDING',
      openCase: order.caseStatus === 'OPEN',
      delivered: Boolean(order.deliveredAt),
    },
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

function toHandlingDays(order = {}) {
  const start = order.orderedAt || order.createdAt;
  const end = order.shipByDate;
  if (!start || !end) return null;

  const startedAt = new Date(start).getTime();
  const shipBy = new Date(end).getTime();
  if (Number.isNaN(startedAt) || Number.isNaN(shipBy) || shipBy < startedAt) return null;

  return Math.ceil((shipBy - startedAt) / (24 * 60 * 60 * 1000));
}

function toHandlingLabel(days) {
  if (days === null || days === undefined) return null;
  return `${days} ${days === 1 ? 'Day' : 'Days'}`;
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
    assignedStaffIds: (order.assignedStaffIds || []).map(toId).filter(Boolean),
    replacementOfOrderId: toId(order.replacementOfOrderId),
    replacementOfOrderItemId: toId(order.replacementOfOrderItemId),
    replacementSequence: order.replacementSequence || null,
    replacementReason: order.replacementReason || null,
    isReplacement: Boolean(order.replacementOfOrderId || order.replacementOfOrderItemId),
    importSources: order.importSources || [],
  };
}

function toExpandedOrderItem(item = {}) {
  return {
    ...require('./orderItem.dto').toMarketplaceItemFields(item),
    id: toId(item._id || item.id),
    externalItemId: item.externalItemId,
    sku: item.sku || null,
    title: item.title || null,
    quantity: item.quantity || 0,
    status: item.status,
    csNote: item.csNote || null,
    listingId: toId(item.listingId),
    replacementOfOrderId: toId(item.replacementOfOrderId),
    replacementOfOrderItemId: toId(item.replacementOfOrderItemId),
    replacementSequence: item.replacementSequence || null,
    replacementReason: item.replacementReason || null,
    isReplacement: Boolean(item.replacementOfOrderId || item.replacementOfOrderItemId),
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

function toAssetDownloadUrl(assetId) {
  const id = toId(assetId);
  return id ? `/api/media/assets/${id}/download` : null;
}

function toCompactListing(listing = null) {
  if (!listing) return null;
  return {
    id: toId(listing._id || listing.id),
    sku: listing.sku || null,
    asin: listing.asin || null,
    etsyListingId: listing.etsyListingId || null,
    title: listing.title || null,
    productImageUrl: listing.productImageUrl || null,
  };
}

function toWorkbenchAssignee(user = null) {
  if (!user || typeof user !== 'object') return null;
  return {
    employeeCode: user.employeeCode || null,
    name: user.fullName || user.name || null,
  };
}

function toWorkbenchScaleBy(production = {}) {
  const projectionScaleBy = production.scaleBy;
  if (
    projectionScaleBy
    && typeof projectionScaleBy === 'object'
    && (projectionScaleBy.employeeCode || projectionScaleBy.name || projectionScaleBy.fullName)
  ) {
    return toWorkbenchAssignee(projectionScaleBy);
  }
  return toWorkbenchAssignee(production.assignedDesigner);
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
    scaleBy: toWorkbenchScaleBy(production),
    qcBy: toId(production.qcBy),
    ...(production.qcByUser ? { qcByUser: production.qcByUser } : {}),
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
    scaleBy: toWorkbenchScaleBy(production),
    qcBy: toId(production.qcBy),
    ...(production.qcByUser ? { qcByUser: production.qcByUser } : {}),
  };
}

function toWorkbenchOrder(row = {}) {
  const order = row.order || {};
  const shop = row.shop || null;
  const handlingDays = toHandlingDays(order);
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
    shipByDate: order.shipByDate || null,
    handlingDays,
    handlingLabel: toHandlingLabel(handlingDays),
    status: order.status || null,
    psdStatus: order.psdStatus || null,
    buyer: {
      name: order.buyer?.name || null,
      emailMasked: order.buyer?.emailMasked || null,
      phoneMasked: order.buyer?.phoneMasked || null,
      externalBuyerId: order.buyer?.externalBuyerId || null,
    },
    pricing: {
      customerPaidAmount: order.totalAmount || itemPricing.reduce((total, pricing) => total + (pricing.customerPaidAmount || 0), 0),
      baseCostAmount: sumNullable('baseCostAmount'),
      totalCostAmount: sumNullable('totalCostAmount'),
      currency: order.currency || itemPricing.find((pricing) => pricing.currency)?.currency || null,
      costCenterStatus: order.costCenterStatus || 'MISSING',
    },
    shopId: toId(order.shopId),
    replacementOfOrderId: toId(order.replacementOfOrderId),
    replacementOfOrderItemId: toId(order.replacementOfOrderItemId),
    replacementSequence: order.replacementSequence || null,
    replacementReason: order.replacementReason || null,
    isReplacement: Boolean(order.replacementOfOrderId || order.replacementOfOrderItemId),
    shop: shop ? {
      id: toId(shop._id || shop.id),
      name: shop.name || null,
    } : null,
    salesChannelCode: order.salesChannelCode || null,
    marketplaceCode: order.marketplaceCode || null,
    addressValidationStatus: order.addressValidationStatus || null,
    shippingAddress: order.shippingAddress || {},
    shippingService: order.shippingService || {},
    caseStatus: order.caseStatus || null,
    caseTitle: row.case?.title || null,
    assignedStaffIds: (order.assignedStaffIds || []).map(toId).filter(Boolean),
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
    assetDownloadUrl: toAssetDownloadUrl(input.assetId),
    mimeType: input.mimeType || null,
  }));
  return {
    payloadId: toId(customization.payloadId),
    status: customization.status || null,
    needsReview: Boolean(customization.needsReview),
    ...(customization.customizationUrl ? { customizationUrl: customization.customizationUrl } : {}),
    ...(customization.sourceCustomizationUrl
      ? { sourceCustomizationUrl: customization.sourceCustomizationUrl }
      : {}),
    ...(customization.downloadedZip ? { downloadedZip: customization.downloadedZip } : {}),
    previewImageUrl: customization.listingPreviewImageUrl || null,
    extractedImages: (customization.imageAssets || []).map((asset) => ({
      assetId: toId(asset.assetId),
      assetDownloadUrl: toAssetDownloadUrl(asset.assetId),
      filename: asset.filename || null,
    })),
    inputs: [...textInputs, ...optionInputs, ...imageInputs],
  };
}

function toVendorSummary(vendor) {
  if (!vendor) return null;
  if (typeof vendor !== 'object') {
    return {
      id: toId(vendor),
      code: null,
      name: null,
    };
  }
  return {
    id: toId(vendor._id || vendor.id),
    code: vendor.code || null,
    name: vendor.name || null,
  };
}

function toWorkbenchPsd(listingVariant = null, listing = null) {
  const listingPsdAssetId = listing?.defaultPsdTemplateAssetId || null;

  return {
    listingVariant: listingVariant ? {
      id: toId(listingVariant.id || listingVariant._id),
      productTypeGroup: listingVariant.productTypeGroup || null,
      internalTemplate: listingVariant.internalTemplate || null,
      psdReadiness: listingVariant.psdReadiness || null,
      psdTemplate: listingVariant.psdTemplateAssetId ? {
        downloadUrl: toAssetDownloadUrl(listingVariant.psdTemplateAssetId),
      } : null,
    } : null,
    listingPsd: listingPsdAssetId ? {
      psdReadiness: { status: 'PRESENT' },
      psdTemplate: { downloadUrl: toAssetDownloadUrl(listingPsdAssetId) },
    } : null,
  };
}

function toWorkbenchMapping(fulfillmentPlan = null, listingVariant = null, listing = null) {
  if (!fulfillmentPlan) return null;
  const vendorProduct = fulfillmentPlan.vendorProduct || null;
  const vendorCostCenter = fulfillmentPlan.vendorCostCenter || null;
  const vendor = fulfillmentPlan.vendor || vendorProduct?.vendor || vendorProduct?.vendorId || vendorCostCenter?.vendor || vendorCostCenter?.vendorId || null;

  return {
    id: toId(fulfillmentPlan.id),
    status: fulfillmentPlan.status || null,
    selectionMode: fulfillmentPlan.selectionMode || null,
    ...toWorkbenchPsd(listingVariant, listing),
    vendor: toVendorSummary(vendor),
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
      ...require('./orderItem.dto').toMarketplaceItemFields({
        ...item,
        salesChannelCode: item.salesChannelCode || row.order?.salesChannelCode,
        externalListingId: item.externalListingId || row.listing?.etsyListingId,
      }),
      id: toId(item._id || item.id),
      orderId: toId(item.orderId),
      externalItemId: item.externalItemId || null,
      sku: item.sku || null,
      title: item.title || null,
      asin: item.asin || row.listing?.asin || null,
      quantity: item.quantity || 0,
      status: item.status || null,
      csNote: item.csNote || null,
      listingId: toId(item.listingId),
      replacementOfOrderId: toId(item.replacementOfOrderId),
      replacementOfOrderItemId: toId(item.replacementOfOrderItemId),
      replacementSequence: item.replacementSequence || null,
      replacementReason: item.replacementReason || null,
      isReplacement: Boolean(item.replacementOfOrderId || item.replacementOfOrderItemId),
    },
    seller: row.seller ? {
      employeeCode: row.seller.employeeCode || null,
      name: row.seller.name || null,
    } : null,
    listing: toCompactListing(row.listing),
    psd: toWorkbenchPsd(row.listingVariant, row.listing),
    customization: toWorkbenchCustomization(row.customization),
    mapping: toWorkbenchMapping(fulfillmentPlan, row.listingVariant, row.listing),
    pricing: {
      customerPaidAmount: toExpandedItemPricing(item, fulfillmentPlan).customerPaidAmount,
      baseCostAmount: getCostEstimateLineAmount(fulfillmentPlan?.costEstimate, 'BASE_COST'),
      totalCostAmount: fulfillmentPlan?.costEstimate?.totalAmount ?? null,
      currency: item.price?.currency || fulfillmentPlan?.costEstimate?.currency || null,
    },
    production: toWorkbenchProduction(row.production),
    tracking: row.tracking || null,
    workflow: deriveOrderItemWorkflow({
      item,
      order: row.order,
      customization: row.customization,
      mapping: fulfillmentPlan,
      listing: row.listing,
      production: row.production,
      shipment: row.tracking,
    }),
  };
}

function toOrderWorkbenchDto(result = {}) {
  return {
    items: (result.items || []).map((row) => ({
      order: toWorkbenchOrder(row),
      items: (row.items || []).map((item) => toWorkbenchItem({ ...item, order: row.order })),
    })),
    pagination: toPagination(result),
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
      item, listing, customization, fulfillmentPlan, production, tracking,
    }) => ({
      item: toExpandedOrderItem(item),
      platform: toItemPlatform(item),
      pricing: toExpandedItemPricing(item, fulfillmentPlan),
      listing: toCompactListing(listing),
      production: toExpandedItemProduction(production),
      customization: customization || null,
      tracking: tracking || null,
      workflow: deriveOrderItemWorkflow({
        item,
        order,
        customization,
        mapping: fulfillmentPlan,
        listing,
        production,
        shipment: tracking,
      }),
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
