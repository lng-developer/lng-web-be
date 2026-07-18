function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') || null;
}

const UNSAFE_KEYS = new Set([
  'localPath',
  'path',
  'absolutePath',
  'providerSecret',
  'apiSecret',
  'apiKey',
  'secret',
  'token',
  'signedUrl',
  'sourceUrl',
  'storagePath',
]);

function stripUnsafe(value) {
  if (Array.isArray(value)) return value.map(stripUnsafe);
  if (!value || typeof value !== 'object') return value;

  return Object.entries(value).reduce((result, [key, entry]) => {
    if (UNSAFE_KEYS.has(key)) return result;
    result[key] = stripUnsafe(entry);
    return result;
  }, {});
}

function toVendorSubmissionDto(submission, { detail = false } = {}) {
  if (!submission) return null;
  const snapshot = submission.payloadSnapshot || {};
  const orderItem = snapshot.orderItem || snapshot.orderItemSnapshot || {};
  const listing = snapshot.listing || snapshot.listingSnapshot || {};
  const vendorProduct = snapshot.vendorProduct || {};
  const vendorCostCenter = snapshot.vendorCostCenter || {};
  const vendor = vendorProduct.vendor || {};
  const dto = {
    id: toId(submission._id || submission.id),
    productionTaskId: toId(submission.productionTaskId),
    orderId: toId(submission.orderId),
    orderItemId: toId(submission.orderItemId),
    shopId: toId(submission.shopId),
    fulfillmentPlanId: toId(submission.fulfillmentPlanId),
    vendorProductId: toId(submission.vendorProductId),
    vendorCostCenterId: toId(submission.vendorCostCenterId),
    status: submission.status,
    provider: submission.provider || null,
    vendorExternalOrderId: submission.vendorExternalOrderId || null,
    externalOrderId: firstValue(orderItem.externalOrderId, snapshot.externalOrderId),
    listingTitle: firstValue(listing.title, orderItem.title),
    sku: firstValue(orderItem.sku, listing.sku),
    vendorName: firstValue(vendor.name, vendorProduct.vendorName),
    vendorProductName: firstValue(vendorProduct.name, vendorProduct.code),
    costCenterCode: firstValue(vendorCostCenter.code, vendorCostCenter.sku),
    submittedBy: toId(submission.submittedBy),
    submittedAt: submission.submittedAt || null,
    failedBy: toId(submission.failedBy),
    failedAt: submission.failedAt || null,
    failureReason: submission.failureReason || null,
    cancelledBy: toId(submission.cancelledBy),
    cancelledAt: submission.cancelledAt || null,
    cancelReason: submission.cancelReason || null,
  };

  if (detail) {
    dto.payloadSnapshot = stripUnsafe(submission.payloadSnapshot || {});
    dto.submittedResponse = stripUnsafe(submission.submittedResponse || null);
    dto.statusHistory = (submission.statusHistory || []).map((entry) => ({
      status: entry.status,
      actorId: toId(entry.actorId),
      reason: entry.reason || null,
      at: entry.at || null,
    }));
    dto.createdAt = submission.createdAt;
    dto.updatedAt = submission.updatedAt;
  }

  return dto;
}

function toPayloadPreviewDto(snapshot = {}) {
  return stripUnsafe(snapshot);
}

function toPaginatedResponse(result) {
  return {
    items: (result.items || []).map((item) => toVendorSubmissionDto(item)),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  stripUnsafe,
  toId,
  toPaginatedResponse,
  toPayloadPreviewDto,
  toVendorSubmissionDto,
};
