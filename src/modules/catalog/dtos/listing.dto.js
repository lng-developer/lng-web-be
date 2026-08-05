const {
  toCompactShop,
  toId,
} = require('./dto.helpers');

function toListingDto(listing, { detail = false, salesStats = null } = {}) {
  if (!listing) return null;

  const dto = {
    id: toId(listing._id || listing.id),
    shopId: toId(listing.shopId),
    shop: toCompactShop(listing.shop),
    salesChannelCode: listing.salesChannelCode,
    marketplaceCode: listing.marketplaceCode,
    sku: listing.sku,
    asin: listing.asin || null,
    etsyListingId: listing.etsyListingId || null,
    title: listing.title,
    seller: listing.seller ? {
      employeeCode: listing.seller.employeeCode || null,
      name: listing.seller.name || null,
    } : null,
    defaultVariantId: toId(listing.defaultVariantId),
    baseCostAmount: listing.baseCostAmount,
    currency: listing.currency,
    costCenterStatus: listing.costCenterStatus,
    psdStatus: listing.psdStatus,
    psdReadiness: listing.psdReadiness || null,
    status: listing.status,
    qcStatus: listing.qcStatus,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
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
  }

  return dto;
}

module.exports = {
  toListingDto,
};
