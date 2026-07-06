const catalogService = require('./services/catalog.service');

const publicPort = {
  findListingBySku: catalogService.findListingBySku,
  getListingById: catalogService.getListingById,
  getListingsByIds: catalogService.getListingsByIds,
  getProductTypeGroupById: catalogService.getProductTypeGroupById,
  findProductTypeGroupByCode: catalogService.findProductTypeGroupByCode,
  getInternalTemplateById: catalogService.getInternalTemplateById,
  findInternalTemplateByCode: catalogService.findInternalTemplateByCode,
  getInternalTemplateForListing: catalogService.getInternalTemplateForListing,
};

module.exports = publicPort;
