const service = require('./services/vendor.service');

const publicPort = {
  getVendorById: service.getVendorById,
  findVendorByCode: service.findVendorByCode,
  getVendorProductById: service.getVendorProductById,
  findVendorProductByCode: service.findVendorProductByCode,
  listActiveVendorProductsByProductTypeGroup: service.listActiveVendorProductsByProductTypeGroup,
  listVendorProducts: service.listVendorProducts,
  searchActiveVendors: service.searchActiveVendors,
  listActiveVendorProductsByVendor: service.listActiveVendorProductsByVendor,
  getVendorProductOptions: service.getVendorProductOptions,
  listActiveVendorCostCenters: service.listActiveVendorCostCenters,
  listActiveVendorCostCentersByProductIds: service.listActiveVendorCostCentersByProductIds,
  searchVendorCostCenters: service.searchVendorCostCenters,
  findVendorCostCenterByCode: service.findVendorCostCenterByCode,
  getVendorIntegrationCredential: service.getVendorIntegrationCredential,
  getVendorIntegrationConfig: service.getVendorIntegrationConfig,
  getVendorIntegrationAssignment: service.getVendorIntegrationAssignment,
  refreshVendorIntegrationCredential: service.refreshVendorIntegrationCredential,
  selectCostRate: service.selectCostRate,
};

module.exports = publicPort;
