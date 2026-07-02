const catalogService = require('./services/catalog.service');

const publicPort = {
  findListingBySku: catalogService.findListingBySku,
  getListingById: catalogService.getListingById,
  getProductTypeGroupById: catalogService.getProductTypeGroupById,
  getInternalTemplateById: catalogService.getInternalTemplateById,
  findInternalTemplateByCode: catalogService.findInternalTemplateByCode,
  getInternalTemplateForListing: catalogService.getInternalTemplateForListing,
};

module.exports = publicPort;
