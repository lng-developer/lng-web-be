function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function compactListing(listing) {
  if (!listing) return null;
  return {
    id: toId(listing),
    sku: listing.sku || null,
    title: listing.title || null,
    productTypeGroupId: toId(listing.productTypeGroupId),
    internalTemplateId: toId(listing.internalTemplateId),
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

function compactVendorProduct(product) {
  if (!product) return null;
  return {
    id: toId(product),
    code: product.code || null,
    name: product.name || null,
    vendor: product.vendor || product.vendorId || null,
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

function toPreviewDto(preview) {
  return {
    orderItemId: toId(preview.orderItemId),
    orderId: toId(preview.orderId),
    ready: Boolean(preview.ready),
    selectedVendorProductId: toId(preview.selectedVendorProductId),
    selectedVendorCostCenterId: toId(preview.selectedVendorCostCenterId),
    checks: preview.checks || {},
    blockingReasons: preview.blockingReasons || [],
    listing: compactListing(preview.listing),
    internalTemplate: compactTemplate(preview.internalTemplate),
    productTypeGroupId: toId(preview.productTypeGroupId),
    skuNormalization: preview.skuNormalization || null,
    skuMapping: preview.skuMapping || null,
    normalizedInputs: preview.normalizedInputs || [],
    autoMatch: preview.autoMatch || null,
    vendorProductCandidates: (preview.vendorProductCandidates || []).map(compactVendorProduct),
    costCenterCandidates: (preview.costCenterCandidates || []).map(compactCostCenter),
  };
}

function toFulfillmentPlanDto(plan) {
  if (!plan) return null;
  const snapshot = plan.snapshot || {};
  return {
    id: toId(plan),
    orderId: toId(plan.orderId),
    orderItemId: toId(plan.orderItemId),
    status: plan.status,
    selectionMode: plan.selectionMode || null,
    listing: snapshot.listing || null,
    internalTemplate: snapshot.internalTemplate || null,
    vendorProduct: snapshot.vendorProduct || null,
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
  compactVendorProduct,
  toFulfillmentPlanDto,
  toId,
  toPreviewDto,
};
