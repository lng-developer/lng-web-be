const catalogService = require('./services/catalog.service');

const publicPort = {
  canReadSellerAsset: catalogService.canReadSellerAsset,
  findListingIdsBySellerCode: require('./repositories/listing.repository').findIdsBySellerCode,
  ...require('./services/listingImage.service'),
  fillEtsyListingImage: catalogService.fillEtsyListingImage,
  findListingBySku: catalogService.findListingBySku,
  findListingForOrderItem: catalogService.findListingForOrderItem,
  findOrCreateListingForOrderItem: catalogService.findOrCreateListingForOrderItem,
  findOrCreateDraftListingForOrderItem: catalogService.findOrCreateDraftListingForOrderItem,
  listListings: catalogService.listListings,
  getListingById: catalogService.getListingById,
  getListingsByIds: catalogService.getListingsByIds,
  getListingSummariesByIds: catalogService.getListingSummariesByIds,
  getProductTypeGroupById: catalogService.getProductTypeGroupById,
  findProductTypeGroupByCode: catalogService.findProductTypeGroupByCode,
  getInternalTemplateById: catalogService.getInternalTemplateById,
  findInternalTemplateByCode: catalogService.findInternalTemplateByCode,
  resolveListingVariant: catalogService.resolveListingVariant,
  getListingVariantById: catalogService.getListingVariantById,
  getListingVariantsByIds: catalogService.getListingVariantsByIds,
  listListingVariantIdsByScaleDifficulty: catalogService.listListingVariantIdsByScaleDifficulty,
  listListingVariantScaleDifficultiesByIds: catalogService.listListingVariantScaleDifficultiesByIds,
  setListingPsdTemplateAsset: catalogService.setListingPsdTemplateAsset,
  setListingVariantPsdTemplateAsset: catalogService.setListingVariantPsdTemplateAsset,
};

module.exports = publicPort;
