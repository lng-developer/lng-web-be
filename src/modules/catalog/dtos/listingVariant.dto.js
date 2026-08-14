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
    printMethod: variant.printMethod || variant.productTypeGroupId?.printMethod || null,
    scaleDifficulty: {
      level: variant.scaleDifficulty?.level || 'NORMAL',
      reason: variant.scaleDifficulty?.reason || null,
      updatedBy: toId(variant.scaleDifficulty?.updatedBy),
      updatedAt: variant.scaleDifficulty?.updatedAt || null,
    },
    status: variant.status,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

module.exports = { toListingVariantDto };
