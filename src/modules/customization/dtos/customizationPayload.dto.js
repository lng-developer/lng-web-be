function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function redactUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(value);
    const pathLabel = url.pathname && url.pathname !== '/' ? '/[REDACTED_PATH]' : '';

    return `${url.protocol}//${url.host}${pathLabel}${url.search ? '?[REDACTED]' : ''}`;
  } catch (error) {
    return '[INVALID_URL]';
  }
}

function findCustomizedUrlAsset(assets = []) {
  return assets.find((asset) => asset && asset.type === 'CUSTOMIZED_URL') || null;
}

function stripLocalPath(value) {
  if (Array.isArray(value)) {
    return value.map(stripLocalPath);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    if (key !== 'localPath') {
      result[key] = stripLocalPath(entryValue);
    }

    return result;
  }, {});
}

function toDownloadedZip(asset) {
  if (!asset) return null;

  const metadata = asset.metadata || {};

  return {
    assetId: toId(asset.assetId),
    type: asset.type,
    status: asset.status,
    sourceUrlRedacted: redactUrl(asset.sourceUrl),
    mimeType: metadata.mimeType || null,
    size: metadata.size ?? null,
    sha256: metadata.sha256 || null,
    classification: metadata.classification || null,
    downloadedAt: metadata.downloadedAt || null,
  };
}

function toZipInspection(asset) {
  if (!asset) return null;

  const metadata = asset.metadata || {};
  const manifest = metadata.zipManifest || null;

  if (!metadata.zipInspectionStatus && !manifest) return null;

  return {
    status: metadata.zipInspectionStatus || null,
    inspectedAt: metadata.zipInspectedAt || null,
    errorCode: metadata.zipInspectionErrorCode || null,
    errorMessage: metadata.zipInspectionErrorMessage || null,
    fileCount: manifest?.fileCount ?? null,
    directoryCount: manifest?.directoryCount ?? null,
    totalCompressedBytes: manifest?.totalCompressedBytes ?? null,
    totalUncompressedBytes: manifest?.totalUncompressedBytes ?? null,
    warnings: manifest?.warnings || [],
    errors: manifest?.errors || [],
  };
}

function toExtractedImage(image = {}) {
  return {
    index: image.index ?? null,
    originalPath: image.originalPath || null,
    normalizedPath: image.normalizedPath || null,
    filename: image.filename || null,
    extension: image.extension || null,
    assetId: toId(image.assetId),
    provider: image.provider || null,
    providerAssetId: image.providerAssetId || null,
    resourceType: image.resourceType || null,
    secureUrl: image.secureUrl || null,
    mimeType: image.mimeType || null,
    size: image.size ?? null,
    sha256: image.sha256 || null,
  };
}

function toFailedImage(image = {}) {
  return {
    index: image.index ?? null,
    originalPath: image.originalPath || null,
    normalizedPath: image.normalizedPath || null,
    filename: image.filename || null,
    extension: image.extension || null,
    errorCode: image.errorCode || null,
    errorMessage: image.errorMessage || null,
  };
}

function toCustomizationPayloadDto(payload) {
  if (!payload) {
    return null;
  }

  const assets = payload.assets || [];
  const customizedUrlAsset = findCustomizedUrlAsset(assets);
  const customizedUrlMetadata = customizedUrlAsset?.metadata || {};
  const parsedData = payload.parsedData || {};
  const customerInputs = parsedData.amazonCustomization?.customerInputs || null;
  const extractedImages = (customizedUrlMetadata.extractedImages || []).map(toExtractedImage);
  const failedImages = (customizedUrlMetadata.failedImages || []).map(toFailedImage);

  return {
    id: toId(payload._id || payload.id),
    orderItemId: toId(payload.orderItemId),
    orderId: toId(payload.orderId),
    shopId: toId(payload.shopId),
    source: payload.source,
    rawRecordId: toId(payload.rawRecordId),
    status: payload.status,
    assets: stripLocalPath(assets),
    downloadedZip: toDownloadedZip(customizedUrlAsset),
    zipInspection: toZipInspection(customizedUrlAsset),
    extractedImages,
    failedImages,
    customerInputs,
    review: {
      status: payload.status,
      needsReview: payload.status === 'NEEDS_REVIEW',
      errorCode: payload.errorCode || null,
      errorMessage: payload.errorMessage || null,
      customerInputs,
      extractedImages,
      failedImages,
    },
    parsedData,
    errorCode: payload.errorCode,
    errorMessage: payload.errorMessage,
    retryCount: payload.retryCount,
    lastTriedAt: payload.lastTriedAt,
    reviewedBy: toId(payload.reviewedBy),
    reviewedAt: payload.reviewedAt,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

function toPaginatedCustomizationPayloadDto(result = {}) {
  return {
    items: (result.items || []).map(toCustomizationPayloadDto),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toCustomizationPayloadDto,
  toPaginatedCustomizationPayloadDto,
};
