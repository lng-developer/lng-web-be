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

function toAssetDownloadUrl(assetId) {
  const id = toId(assetId);
  return id ? `/api/media/assets/${id}/download` : null;
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

function toOrderItemDownloadedZip(asset) {
  if (!asset) return null;

  return {
    status: asset.status,
    sourceUrlRedacted: redactUrl(asset.sourceUrl),
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
    resourceType: image.resourceType || null,
    assetDownloadUrl: toAssetDownloadUrl(image.assetId),
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

function dedupeInputArray(items = []) {
  const byLabelValue = new Map();

  (items || []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const key = `${item.label || ''}\u0000${item.value || ''}`;
    const existing = byLabelValue.get(key);

    if (!existing || (!existing.name && item.name)) {
      byLabelValue.set(key, item);
    }
  });

  return [...byLabelValue.values()];
}

function toCustomerInputsView(customerInputs) {
  if (!customerInputs) return null;

  const result = {};
  if (Object.prototype.hasOwnProperty.call(customerInputs, 'texts')) {
    result.texts = dedupeInputArray(customerInputs.texts);
  }
  if (Object.prototype.hasOwnProperty.call(customerInputs, 'options')) {
    result.options = dedupeInputArray(customerInputs.options);
  }
  if (Object.prototype.hasOwnProperty.call(customerInputs, 'images')) {
    result.images = customerInputs.images || [];
  }

  return result;
}

function toOrderItemCustomizationViewDto(payload, { includeSourceCustomizationUrl = false } = {}) {
  if (!payload) return null;

  const customizedUrlAsset = findCustomizedUrlAsset(payload.assets || []);
  const metadata = customizedUrlAsset?.metadata || {};

  return {
    payloadId: toId(payload._id || payload.id),
    orderItemId: toId(payload.orderItemId),
    status: payload.status,
    needsReview: payload.status === 'NEEDS_REVIEW',
    errorCode: payload.errorCode || null,
    errorMessage: payload.errorMessage || null,
    listingPreviewImageUrl: payload.parsedData?.amazonCustomization?.customerInputs?.listingPreviewImageUrl || null,
    customizationUrl: customizedUrlAsset ? redactUrl(customizedUrlAsset.sourceUrl) : null,
    ...(includeSourceCustomizationUrl && customizedUrlAsset?.sourceUrl
      ? { sourceCustomizationUrl: customizedUrlAsset.sourceUrl }
      : {}),
    downloadedZip: toOrderItemDownloadedZip(customizedUrlAsset),
    customerInputs: toCustomerInputsView(payload.parsedData?.amazonCustomization?.customerInputs),
    imageAssets: (metadata.extractedImages || []).map((image = {}) => ({
      assetId: toId(image.assetId),
      assetDownloadUrl: toAssetDownloadUrl(image.assetId),
      filename: image.filename || null,
      mimeType: image.mimeType || null,
      size: image.size ?? null,
      sha256: image.sha256 || null,
    })),
    failedImages: (metadata.failedImages || []).map((image = {}) => ({
      filename: image.filename || null,
      errorCode: image.errorCode || null,
      errorMessage: image.errorMessage || null,
    })),
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

function assetSummary(assets = []) {
  const extracted = assets.flatMap((asset) => asset?.metadata?.extractedImages || []).length;
  const failedImages = assets.flatMap((asset) => asset?.metadata?.failedImages || []).length;
  return {
    total: assets.length,
    downloaded: assets.filter((asset) => asset.status === 'DOWNLOADED').length,
    failed: assets.filter((asset) => asset.status === 'FAILED').length + failedImages,
    extracted,
    zipInspectionStatus: assets.find((asset) => asset?.metadata?.zipInspectionStatus)?.metadata?.zipInspectionStatus || null,
  };
}

function toOperationalCustomizationDto(payload) {
  const context = payload.context || {};
  const inputs = payload.parsedData?.amazonCustomization?.customerInputs
    || payload.parsedData?.etsyCustomization?.customerInputs
    || null;
  return {
    id: toId(payload._id || payload.id),
    status: payload.status,
    source: payload.source,
    errorCode: payload.errorCode || null,
    errorMessage: payload.errorMessage || null,
    retryCount: payload.retryCount || 0,
    lastTriedAt: payload.lastTriedAt || null,
    reviewedAt: payload.reviewedAt || null,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    order: { externalOrderId: context.order?.externalOrderId || context.item?.externalOrderId || null },
    item: {
      externalItemId: context.item?.externalItemId || null,
      sku: context.item?.sku || null,
      title: context.item?.title || null,
    },
    customer: {
      name: context.order?.buyer?.name || null,
      email: context.order?.buyer?.emailMasked || null,
    },
    shop: { name: context.shop?.name || null },
    inputs: toCustomerInputsView(inputs),
    assets: assetSummary(payload.assets || []),
  };
}

function toOperationalPageDto(result = {}) {
  return {
    items: (result.items || []).map(toOperationalCustomizationDto),
    pagination: { total: result.total || 0, page: result.page || 1, limit: result.limit || 20 },
  };
}

module.exports = {
  toCustomizationPayloadDto,
  toOrderItemCustomizationViewDto,
  toPaginatedCustomizationPayloadDto,
  toOperationalCustomizationDto,
  toOperationalPageDto,
};
