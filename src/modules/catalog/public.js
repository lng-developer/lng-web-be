const catalogService = require('./services/catalog.service');

const publicPort = {
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
  listListingVariantIdsByScaleDifficulty: catalogService.listListingVariantIdsByScaleDifficulty,
  listListingVariantScaleDifficultiesByIds: catalogService.listListingVariantScaleDifficultiesByIds,
  setListingVariantPsdTemplateAsset: catalogService.setListingVariantPsdTemplateAsset,
};

module.exports = publicPort;
