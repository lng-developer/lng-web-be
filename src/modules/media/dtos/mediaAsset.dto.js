function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toMediaAssetDto(asset) {
  if (!asset) return null;
  return {
    id: toId(asset),
    originalFilename: asset.originalFilename || null,
    mimeType: asset.mimeType || null,
    size: asset.size ?? null,
    sha256: asset.sha256 || null,
    provider: asset.provider || null,
    resourceType: asset.resourceType || null,
    secureUrl: asset.secureUrl || null,
    createdAt: asset.createdAt,
  };
}

module.exports = {
  toId,
  toMediaAssetDto,
};
