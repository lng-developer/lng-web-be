const catalogService = require('./services/catalog.service');

const publicPort = {
  findListingBySku: catalogService.findListingBySku,
  findListingForOrderItem: catalogService.findListingForOrderItem,
  findOrCreateListingForOrderItem: catalogService.findOrCreateListingForOrderItem,
  listListings: catalogService.listListings,
  getListingById: catalogService.getListingById,
  getListingsByIds: catalogService.getListingsByIds,
  getListingSummariesByIds: catalogService.getListingSummariesByIds,
  getProductTypeGroupById: catalogService.getProductTypeGroupById,
  findProductTypeGroupByCode: catalogService.findProductTypeGroupByCode,
  getInternalTemplateById: catalogService.getInternalTemplateById,
  findInternalTemplateByCode: catalogService.findInternalTemplateByCode,
  getInternalTemplateForListing: catalogService.getInternalTemplateForListing,
  setListingPsdTemplateAsset: catalogService.setListingPsdTemplateAsset,
};

module.exports = publicPort;
