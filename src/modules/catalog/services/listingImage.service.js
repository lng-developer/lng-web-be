const repository = require('../repositories/listing.repository');

function isAmazonImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images.amazon.com'].includes(url.hostname);
  } catch { return false; }
}
function canSyncListingImage(listing) {
  if (!listing || listing.imageSync?.source === 'MANUAL') return false;
  return !listing.productImageUrl || ['IMPORTED', 'AMAZON_SYNC'].includes(listing.imageSync?.source)
    // Historical image ownership recognition stays narrower than upload URL trust.
    || (isAmazonImageUrl(listing.productImageUrl) && new URL(listing.productImageUrl).pathname.startsWith('/images/I/'))
    || /^https:\/\/m\.media-amazon\.com\/images\/S\/gestalt-seller-images-prod-us-east-1\//.test(listing.productImageUrl);
}
async function findImageSyncCandidates(input) {
  return (await repository.findImageSyncCandidates(input)).filter(canSyncListingImage);
}
async function getImageSyncListing({ listingId, shopId, asin }) {
  const listing = await repository.findById(listingId);
  return listing && String(listing.shopId) === String(shopId) && listing.asin === asin
    && listing.salesChannelCode === 'AMAZON' && listing.marketplaceCode === 'US' && canSyncListingImage(listing) ? listing : null;
}
function applySyncedListingImage(listing, patch) {
  return repository.compareAndSetImage(listing, patch);
}
module.exports = { isAmazonImageUrl, canSyncListingImage, findImageSyncCandidates, getImageSyncListing, applySyncedListingImage };
