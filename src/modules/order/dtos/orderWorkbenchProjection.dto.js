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

function toWorkbenchScaledOutputs(production = null) {
  if (!production) return [];
  const sources = [
    production.scaledOutputs,
    production.fileChecks,
    production.qcPreviewFileChecks,
    production.scaleContext?.use?.scaleSlots,
  ];
  for (const list of sources) {
    if (Array.isArray(list) && list.length > 0) {
      const outputs = list
        .filter((check) => check && (check.outputAssetId || check.outputAssetDownloadUrl))
        .map((check) => ({
          id: toId(check._id || check.id || check.fileCheckId),
          slotKey: check.slotKey || null,
          slotLabel: check.slotLabel || check.slotKey || null,
          outputAssetId: toId(check.outputAssetId),
          outputAssetDownloadUrl: check.outputAssetDownloadUrl || toAssetDownloadUrl(check.outputAssetId),
          scaleStatus: check.scaleStatus || null,
          qcStatus: check.qcStatus || null,
        }));
      if (outputs.length > 0) return outputs;
    }
  }
  return [];
}

function toOrderWorkbenchRow(projection = {}) {
  return {
    order: projection.order || {},
    shop: projection.shop || null,
    case: projection.case || null,
    items: (projection.items || []).map(({ orderItemId, ...item }) => {
      const scaledOutputs = toWorkbenchScaledOutputs(item.production);
      const production = item.production ? {
        ...item.production,
        scaledOutputs,
      } : null;
      return {
        ...item,
        production,
        psd: item.psd || toWorkbenchPsd(item.listingVariant, item.listing, item.production),
      };
    }),
  };
}

module.exports = { toOrderWorkbenchRow };
