function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function toOrderItemDto(item) {
  if (!item) {
    return null;
  }

  return {
    id: toId(item._id || item.id),
    orderId: toId(item.orderId),
    shopId: toId(item.shopId),
    shopConnectionId: toId(item.shopConnectionId),
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    externalOrderId: item.externalOrderId,
    externalItemId: item.externalItemId,
    externalProductId: item.externalProductId,
    externalListingId: item.externalListingId,
    externalVariantId: item.externalVariantId,
    asin: item.asin,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    price: item.price,
    listingId: toId(item.listingId),
    replacementOfOrderId: toId(item.replacementOfOrderId),
    replacementOfOrderItemId: toId(item.replacementOfOrderItemId),
    replacementSequence: item.replacementSequence || null,
    replacementReason: item.replacementReason || null,
    isReplacement: Boolean(item.replacementOfOrderId || item.replacementOfOrderItemId),
    externalStatus: item.externalStatus,
    status: item.status,
    csNote: item.csNote || null,
    shipByDate: item.shipByDate,
    importSources: item.importSources || [],
    importedAt: item.importedAt,
    lastImportedAt: item.lastImportedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toPaginatedOrderItemDto(result = {}) {
  return {
    items: (result.items || []).map(toOrderItemDto),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

function etsyImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'i.etsystatic.com' && !url.port && !url.username && !url.password) return url.href;
  } catch (_) { /* Missing or untrusted image is not rendered. */ }
  return null;
}

function toMarketplaceItemFields(item = {}) {
  const listingImageUrl = etsyImageUrl(item.listingImageUrl || item.externalData?.etsy?.listingImageUrl);
  return {
    salesChannelCode: item.salesChannelCode || null,
    externalListingId: item.externalListingId || null,
    variations: item.salesChannelCode === 'ETSY' && typeof (item.variations ?? item.variantRaw) === 'string' ? (item.variations ?? item.variantRaw) : null,
    listingImageUrl: item.salesChannelCode === 'ETSY' ? listingImageUrl : null,
    listingImageThumbnailUrl: item.salesChannelCode === 'ETSY' ? etsyImageUrl(item.listingImageThumbnailUrl || item.externalData?.etsy?.listingImageThumbnailUrl) : null,
    listingImageAssetId: item.salesChannelCode === 'ETSY'
      ? toId(item.listingImageAssetId || (item.listingImage?.sourceUrl === item.externalData?.etsy?.listingImageUrl ? item.listingImage?.mediaAssetId : null)) : null,
  };
}

module.exports = {
  toMarketplaceItemFields,
  toOrderItemDto,
  toPaginatedOrderItemDto,
};
