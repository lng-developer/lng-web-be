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
  updateVendorIntegrationConfigSchema,
  refreshVendorIntegrationCredentialSchema,
  updateVendorSchema,
} = require('../validators/vendor.validator');
const { assertValid } = require('./requestValidation');

function auditAuth(req) {
  return {
    ...req.auth,
    source: 'HTTP',
    auditContext: {
      requestId: req.id ? String(req.id).slice(0, 200) : null,
      ipAddress: req.ip ? String(req.ip).slice(0, 100) : null,
      userAgent: req.get?.('user-agent') ? String(req.get('user-agent')).slice(0, 500) : null,
    },
  };
}

async function listVendors(req, res) {
  const query = assertValid(listVendorsQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listVendors(query) });
}

async function getVendor(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.getVendor(req.params.id) });
}

async function createVendor(req, res) {
  const payload = assertValid(createVendorSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createVendor(payload, auditAuth(req)) });
}

async function updateVendor(req, res) {
  const payload = assertValid(updateVendorSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateVendor(req.params.id, payload, auditAuth(req)) });
}

async function getVendorIntegrationConfig(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getVendorIntegrationConfig(req.params.vendorId, auditAuth(req)),
  });
}

async function updateVendorIntegrationConfig(req, res) {
  const payload = assertValid(updateVendorIntegrationConfigSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateVendorIntegrationConfig(req.params.vendorId, payload, auditAuth(req)),
  });
}

async function refreshVendorIntegrationCredential(req, res) {
  const payload = assertValid(refreshVendorIntegrationCredentialSchema, req.body);
  const result = await service.refreshVendorIntegrationCredentialForVendor(
    req.params.vendorId,
    payload.providerKey,
    auditAuth(req),
  );
  res.status(httpStatus.OK).json({
    success: true,
    data: {
      providerKey: result.providerKey,
      vendorId: result.vendorId,
      baseUrl: result.baseUrl,
      authType: result.authType,
      status: result.status,
      expiresAt: result.expiresAt,
    },
  });
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
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createVendorProduct(payload, auditAuth(req)) });
}

async function updateVendorProduct(req, res) {
  const payload = assertValid(updateVendorProductSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateVendorProduct(req.params.id, payload, auditAuth(req)) });
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
    data: await service.createVendorCostCenter(req.params.productId, payload, auditAuth(req)),
  });
}

async function updateVendorCostCenter(req, res) {
  const payload = assertValid(updateVendorCostCenterSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateVendorCostCenter(req.params.productId, req.params.costCenterId, payload, auditAuth(req)),
  });
}

module.exports = {
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  getVendorIntegrationConfig,
  updateVendorIntegrationConfig,
  refreshVendorIntegrationCredential,
  listVendorProducts,
  getVendorProduct,
  createVendorProduct,
  updateVendorProduct,
  listVendorCostCenters,
  createVendorCostCenter,
  updateVendorCostCenter,
};
