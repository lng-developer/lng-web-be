function id(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}
function safeSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    sku: snapshot.sku || null,
    title: snapshot.title || null,
    listingId: snapshot.listingId || null,
    listingVariantId: snapshot.listingVariantId || null,
  };
}
function toDesignRequestDto(request) {
  if (!request) return null;
  return {
    id: id(request),
    orderId: id(request.orderId),
    orderItemId: id(request.orderItemId),
    shopId: id(request.shopId),
    requestType: request.requestType,
    status: request.status,
    requestedByAccountId: id(request.requestedByAccountId),
    assignedDesignerAccountId: id(request.assignedDesignerAccountId),
    note: request.note || null,
    listingSnapshot: safeSnapshot(request.listingSnapshot),
    createdAt: request.createdAt || null,
    updatedAt: request.updatedAt || null,
  };
}
module.exports = { toDesignRequestDto };
