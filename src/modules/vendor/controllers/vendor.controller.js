const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/vendor.service');
const {
  createVendorProductSchema,
  createVendorCostCenterSchema,
  createVendorSchema,
  listVendorProductsQuerySchema,
  listVendorCostCentersQuerySchema,
  listVendorsQuerySchema,
  updateVendorProductSchema,
  updateVendorCostCenterSchema,
  updateVendorSchema,
} = require('../validators/vendor.validator');
const { assertValid } = require('./requestValidation');

async function listVendors(req, res) {
  const query = assertValid(listVendorsQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listVendors(query) });
}

async function getVendor(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.getVendor(req.params.id) });
}

async function createVendor(req, res) {
  const payload = assertValid(createVendorSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createVendor(payload) });
}

async function updateVendor(req, res) {
  const payload = assertValid(updateVendorSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateVendor(req.params.id, payload) });
}

async function listVendorProducts(req, res) {
  const query = assertValid(listVendorProductsQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listVendorProducts(query) });
}

async function getVendorProduct(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.getVendorProduct(req.params.id) });
}

async function createVendorProduct(req, res) {
  const payload = assertValid(createVendorProductSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createVendorProduct(payload) });
}

async function updateVendorProduct(req, res) {
  const payload = assertValid(updateVendorProductSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateVendorProduct(req.params.id, payload) });
}

async function listVendorCostCenters(req, res) {
  const query = assertValid(listVendorCostCentersQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listVendorCostCenters(req.params.productId, query),
  });
}

async function createVendorCostCenter(req, res) {
  const payload = assertValid(createVendorCostCenterSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createVendorCostCenter(req.params.productId, payload),
  });
}

async function updateVendorCostCenter(req, res) {
  const payload = assertValid(updateVendorCostCenterSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateVendorCostCenter(req.params.productId, req.params.costCenterId, payload),
  });
}

module.exports = {
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  listVendorProducts,
  getVendorProduct,
  createVendorProduct,
  updateVendorProduct,
  listVendorCostCenters,
  createVendorCostCenter,
  updateVendorCostCenter,
};
