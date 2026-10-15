const repository = require('../repositories/orderItem.repository');
const media = require('../../media/public');
const projection = require('./orderWorkbenchProjection.service');

async function processListingImage({ orderItemId, shopId, sourceUrl }) {
  const item = await repository.findById(orderItemId);
  if (!item || item.salesChannelCode !== 'ETSY' || String(item.shopId) !== String(shopId)
    || item.externalData?.etsy?.listingImageUrl !== sourceUrl) return { skipped: true };
  const { mediaAssetId } = await media.storeEtsyListingImage({ shopId, sourceUrl });
  const attached = await repository.attachListingImage({ orderItemId, shopId, sourceUrl, mediaAssetId });
  if (!attached) return { skipped: true };
  await require('../../catalog/public').fillEtsyListingImage({
    shopId: attached.shopId, marketplaceCode: attached.marketplaceCode,
    etsyListingId: attached.externalListingId, productImageUrl: sourceUrl,
  });
  await projection.updateOrderWorkbenchItem(attached.orderId, orderItemId, { 'item.listingImageAssetId': mediaAssetId }, { expectedListingImageUrl: new URL(sourceUrl).href });
  return { mediaAssetId };
}

module.exports = { processListingImage };
