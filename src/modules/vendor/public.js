const service = require('./services/vendor.service');

const publicPort = {
  getVendorById: service.getVendorById,
  findVendorByCode: service.findVendorByCode,
  getVendorProductById: service.getVendorProductById,
  findVendorProductByCode: service.findVendorProductByCode,
  listActiveVendorProductsByProductTypeGroup: service.listActiveVendorProductsByProductTypeGroup,
  listActiveVendorCostCenters: service.listActiveVendorCostCenters,
  listActiveVendorCostCentersByProductIds: service.listActiveVendorCostCentersByProductIds,
  searchVendorCostCenters: service.searchVendorCostCenters,
  findVendorCostCenterByCode: service.findVendorCostCenterByCode,
};

module.exports = publicPort;
