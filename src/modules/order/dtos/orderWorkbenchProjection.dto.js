function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toAssetDownloadUrl(assetId) {
  const id = toId(assetId);
  return id ? `/api/media/assets/${id}/download` : null;
}

function toWorkbenchPsd(listingVariant = null, listing = null, production = null) {
  const prodPsd = production?.scaleContext?.use?.psdTemplate;
  const listingPsdAssetId = toId(listing?.defaultPsdTemplateAssetId || prodPsd?.assetId);

  return {
    listingVariant: listingVariant ? {
      id: toId(listingVariant.id || listingVariant._id),
      productTypeGroup: listingVariant.productTypeGroup || null,
      internalTemplate: listingVariant.internalTemplate || null,
      psdReadiness: listingVariant.psdReadiness || null,
      psdTemplate: listingVariant.psdTemplateAssetId ? {
        downloadUrl: toAssetDownloadUrl(listingVariant.psdTemplateAssetId),
      } : null,
    } : null,
    listingPsd: listingPsdAssetId ? {
      psdReadiness: { status: "PRESENT" },
      psdTemplate: { downloadUrl: prodPsd?.assetDownloadUrl || toAssetDownloadUrl(listingPsdAssetId) },
    } : null,
  };
}

function toOrderWorkbenchRow(projection = {}) {
  return {
    order: projection.order || {},
    shop: projection.shop || null,
    case: projection.case || null,
    items: (projection.items || []).map(({ orderItemId, ...item }) => ({
      ...item,
      psd: item.psd || toWorkbenchPsd(item.listingVariant, item.listing, item.production),
    })),
  };
}

module.exports = { toOrderWorkbenchRow };
