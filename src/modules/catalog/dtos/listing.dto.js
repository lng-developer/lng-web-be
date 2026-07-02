const {
  toCompactInternalTemplate,
  toCompactProductTypeGroup,
  toId,
} = require('./dto.helpers');

function toListingDto(listing, { detail = false } = {}) {
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
    baseCostAmount: listing.baseCostAmount,
    currency: listing.currency,
    costCenterStatus: listing.costCenterStatus,
    psdStatus: listing.psdStatus,
    status: listing.status,
    qcStatus: listing.qcStatus,
  };

  if (detail) {
    dto.createdAt = listing.createdAt;
    dto.updatedAt = listing.updatedAt;
  }

  return dto;
}

module.exports = {
  toListingDto,
};
