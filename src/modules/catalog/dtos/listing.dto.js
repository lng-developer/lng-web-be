const {
  toCompactInternalTemplate,
  toCompactProductTypeGroup,
  toId,
} = require('./dto.helpers');

function toListingDto(listing, { detail = false, salesStats = null } = {}) {
  if (!listing) return null;

  const dto = {
    id: toId(listing._id || listing.id),
    shopId: toId(listing.shopId),
    salesChannelCode: listing.salesChannelCode,
    marketplaceCode: listing.marketplaceCode,
    sku: listing.sku,
    asin: listing.asin || null,
    etsyListingId: listing.etsyListingId || null,
    title: listing.title,
    productTypeGroup: toCompactProductTypeGroup(listing.productTypeGroupId),
    internalTemplate: toCompactInternalTemplate(listing.internalTemplateId),
    psdTemplateAssetId: toId(listing.psdTemplateAssetId),
    baseCostAmount: listing.baseCostAmount,
    currency: listing.currency,
    costCenterStatus: listing.costCenterStatus,
    psdStatus: listing.psdStatus,
    status: listing.status,
    qcStatus: listing.qcStatus,
    salesStats: salesStats || {
      orderCount: 0,
      orderItemCount: 0,
      quantitySold: 0,
      lastSoldAt: null,
    },
  };

  if (detail) {
    dto.approvedBy = toId(listing.approvedBy);
    dto.approvedAt = listing.approvedAt || null;
    dto.rejectedBy = toId(listing.rejectedBy);
    dto.rejectedAt = listing.rejectedAt || null;
    dto.rejectionReason = listing.rejectionReason || null;
    dto.createdAt = listing.createdAt;
    dto.updatedAt = listing.updatedAt;
  }

  return dto;
}

module.exports = {
  toListingDto,
};
