const {
  toCompactInternalTemplate,
  toCompactProductTypeGroup,
  toCompactShop,
  toId,
} = require('./dto.helpers');

function toAssetDownloadUrl(assetId) {
  const id = toId(assetId);
  return id ? `/api/media/assets/${id}/download` : null;
}

function toAssetRefDto(assetId, asset = null) {
  const id = toId(assetId);
  if (!id) return null;
  return {
    assetId: id,
    downloadUrl: toAssetDownloadUrl(id),
    originalFilename: asset?.originalFilename || null,
    mimeType: asset?.mimeType || null,
    size: asset?.size ?? null,
    provider: asset?.provider || null,
    createdAt: asset?.createdAt || null,
    ...(asset?.secureUrl ? { previewUrl: asset.secureUrl } : {}),
  };
}

function toListingDto(listing, { detail = false, salesStats = null } = {}) {
  if (!listing) return null;
  const previewAssetId = toId(listing.previewAssetId);

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
    productTypeGroup: toCompactProductTypeGroup(listing.productTypeGroupId),
    internalTemplate: toCompactInternalTemplate(listing.internalTemplateId),
    psdTemplateAssetId: toId(listing.psdTemplateAssetId),
    psdTemplateAsset: toAssetRefDto(listing.psdTemplateAssetId, listing.psdTemplateAsset),
    previewAssetId,
    previewAsset: toAssetRefDto(previewAssetId, listing.previewAsset),
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
