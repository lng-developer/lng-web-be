const { toCompactProductTypeGroup, toId } = require('./dto.helpers');

function toRequiredFieldDto(field = {}) {
  return {
    key: field.key,
    label: field.label || null,
    type: field.type,
    required: Boolean(field.required),
    source: field.source || null,
    validation: field.validation || {},
    sortOrder: field.sortOrder || 0,
  };
}

function toArtworkSlotDto(slot = {}) {
  return {
    key: slot.key,
    label: slot.label || null,
    type: slot.type,
    required: Boolean(slot.required),
    acceptedFieldKeys: slot.acceptedFieldKeys || [],
    outputRole: slot.outputRole || null,
    sortOrder: slot.sortOrder || 0,
  };
}

function toDesignAssetDto(asset = {}) {
  return {
    mediaAssetId: toId(asset.mediaAssetId),
    type: asset.type,
    version: asset.version || 'v1',
    label: asset.label || null,
    status: asset.status,
    metadata: asset.metadata || {},
  };
}

function toInternalTemplateDto(template, { detail = false } = {}) {
  if (!template) return null;

  const requiredFields = template.requiredFields || [];
  const artworkSlots = template.artworkSlots || [];
  const designAssets = template.designAssets || [];

  const dto = {
    id: toId(template._id || template.id),
    code: template.code,
    name: template.name,
    description: template.description || null,
    productTypeGroup: toCompactProductTypeGroup(template.productTypeGroupId),
    requiresPsd: template.requiresPsd !== false,
    status: template.status,
  };

  if (detail) {
    dto.requiredFields = requiredFields.map(toRequiredFieldDto);
    dto.artworkSlots = artworkSlots.map(toArtworkSlotDto);
    dto.designAssets = designAssets.map(toDesignAssetDto);
    dto.createdAt = template.createdAt;
    dto.updatedAt = template.updatedAt;
    return dto;
  }

  dto.requiredFieldsCount = requiredFields.length;
  dto.artworkSlotsCount = artworkSlots.length;
  dto.designAssetsCount = designAssets.length;
  return dto;
}

module.exports = {
  toInternalTemplateDto,
};
