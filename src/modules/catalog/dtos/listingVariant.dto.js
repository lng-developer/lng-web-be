const { toCompactInternalTemplate, toCompactProductTypeGroup, toId } = require('./dto.helpers');

function toListingVariantDto(variant) {
  if (!variant) return null;
  return {
    id: toId(variant._id || variant.id),
    listingId: toId(variant.listingId),
    productTypeGroup: toCompactProductTypeGroup(variant.productTypeGroupId),
    internalTemplate: toCompactInternalTemplate(variant.internalTemplateId),
    psdTemplateAssetId: toId(variant.psdTemplateAssetId),
    previewAssetId: toId(variant.previewAssetId),
    status: variant.status,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

module.exports = { toListingVariantDto };
