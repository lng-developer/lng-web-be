function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function compactListing(listing) {
  if (!listing) return null;
  return {
    id: toId(listing),
    sku: listing.sku || null,
    title: listing.title || null,
    printMethod: listing.printMethod || null,
    defaultPsdTemplateAssetId: toId(listing.defaultPsdTemplateAssetId),
  };
}

function compactTemplate(template) {
  if (!template) return null;
  return {
    id: toId(template),
    code: template.code || null,
    name: template.name || null,
    status: template.status || null,
  };
}

function compactVendor(vendor) {
  if (!vendor) return null;
  if (typeof vendor !== 'object') return { id: toId(vendor), code: null, name: null, status: null };
  return {
    id: toId(vendor),
    code: vendor.code || null,
    name: vendor.name || null,
    status: vendor.status || null,
  };
}

function compactVendorProduct(product) {
  if (!product) return null;
  return {
    id: toId(product),
    code: product.code || null,
    name: product.name || null,
    vendor: compactVendor(product.vendor || product.vendorId),
    baseCostAmount: product.baseCostAmount ?? null,
    currency: product.currency || null,
  };
}

function compactCostCenter(costCenter) {
  if (!costCenter) return null;
  return {
    id: toId(costCenter),
    vendorProductId: toId(costCenter.vendorProductId),
    code: costCenter.code || null,
    name: costCenter.name || null,
    sku: costCenter.sku || null,
    lngCode: costCenter.lngCode || null,
    standardSize: costCenter.standardSize || null,
    standardColor: costCenter.standardColor || null,
    printMethod: costCenter.printMethod || null,
    baseCostAmount: costCenter.baseCostAmount ?? null,
    currency: costCenter.currency || null,
    matchScore: costCenter.matchScore ?? 0,
    matchReasons: costCenter.matchReasons || [],
    confidence: costCenter.confidence || null,
    routingSpecificity: costCenter.routingSpecificity ?? 0,
    routingPriority: costCenter.routingPriority ?? null,
    costEstimate: costCenter.costEstimate || null,
  };
}

function toPreviewDto(preview, { includeCandidates = true } = {}) {
  const vendorProductCandidates = preview.vendorProductCandidates || [];
  const costCenterCandidates = preview.costCenterCandidates || [];
  const dto = {
    orderItemId: toId(preview.orderItemId),
    orderId: toId(preview.orderId),
    ready: Boolean(preview.ready),
    selectedVendorProductId: toId(preview.selectedVendorProductId),
    selectedVendorCostCenterId: toId(preview.selectedVendorCostCenterId),
    checks: preview.checks || {},
    blockingReasons: preview.blockingReasons || [],
    listing: compactListing(preview.listing),
    listingVariantId: toId(preview.listingVariantId),
    internalTemplate: compactTemplate(preview.internalTemplate),
    productTypeGroupId: toId(preview.productTypeGroupId),
    printMethod: preview.printMethod || null,
    skuNormalization: preview.skuNormalization || null,
    skuMapping: preview.skuMapping || null,
    normalizedInputs: preview.normalizedInputs || [],
    autoMatch: preview.autoMatch || null,
    candidateSummary: {
      vendorProductCount: vendorProductCandidates.length,
      costCenterCount: costCenterCandidates.length,
      topCandidate: compactCostCenter(costCenterCandidates[0]),
    },
  };
  if (includeCandidates) {
    dto.vendorProductCandidates = vendorProductCandidates.map(compactVendorProduct);
    dto.costCenterCandidates = costCenterCandidates.map(compactCostCenter);
  }
  return dto;
}

function toFulfillmentPlanDto(plan) {
  if (!plan) return null;
  const snapshot = plan.snapshot || {};
  const vendor = compactVendor(snapshot.vendor || snapshot.vendorProduct?.vendor || snapshot.vendorProduct?.vendorId);
  const vendorProduct = snapshot.vendorProduct ? {
    ...snapshot.vendorProduct,
    vendor: vendor || compactVendor(snapshot.vendorProduct.vendor || snapshot.vendorProduct.vendorId),
  } : null;
  return {
    id: toId(plan),
    orderId: toId(plan.orderId),
    orderItemId: toId(plan.orderItemId),
    listingVariantId: toId(plan.listingVariantId),
    status: plan.status,
    selectionMode: plan.selectionMode || null,
    listing: snapshot.listing || null,
    internalTemplate: snapshot.internalTemplate || null,
    vendor,
    vendorProduct,
    vendorCostCenter: snapshot.vendorCostCenter || null,
    costEstimate: snapshot.costEstimate || null,
    blockingReasons: plan.blockingReasons || [],
    checks: plan.checks || {},
    resolvedAt: plan.resolvedAt || null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

module.exports = {
  compactCostCenter,
  compactListing,
  compactTemplate,
  compactVendor,
  compactVendorProduct,
  toFulfillmentPlanDto,
  toId,
  toPreviewDto,
};
