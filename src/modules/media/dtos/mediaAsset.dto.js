function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toMediaAssetDto(asset) {
  if (!asset) return null;
  const id = toId(asset);
  return {
    id,
    originalFilename: asset.originalFilename || null,
    mimeType: asset.mimeType || null,
    size: asset.size ?? null,
    sha256: asset.sha256 || null,
    provider: asset.provider || null,
    resourceType: asset.resourceType || null,
    ownerType: asset.ownerType || null,
    status: asset.discardedAt ? 'DISCARDED' : 'ACTIVE',
    downloadUrl: id ? `/api/media/assets/${id}/download` : null,
    createdAt: asset.createdAt,
  };
}

function toMediaAssetListDto(result) {
  return {
    items: result.items.map((asset) => {
      const dto = toMediaAssetDto(asset);
      delete dto.sha256;
      return dto;
    }),
    pagination: result.pagination,
  };
}

module.exports = {
  toId,
  toMediaAssetDto,
  toMediaAssetListDto,
};
