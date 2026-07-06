const { assertValidObjectId } = require('../../../shared/utils/objectId');
const catalogPublic = require('../../catalog/public');
const { recordStatuses } = require('../constants/vendor.constants');
const vendorRepository = require('../repositories/vendor.repository');
const productRepository = require('../repositories/vendorProduct.repository');
const costCenterRepository = require('../repositories/vendorCostCenter.repository');
const {
  toPaginatedResponse,
  toVendorDto,
  toVendorProductDto,
  toVendorCostCenterDto,
} = require('../dtos/vendor.dto');
const {
  conflict,
  mapDuplicate,
  notFound,
} = require('./vendorError.helpers');

function normalizeCode(value) {
  return value === undefined || value === null ? value : String(value).trim().toUpperCase();
}

function mutablePatch(patch = {}, allowedFields = []) {
  return allowedFields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      result[field] = patch[field];
    }
    return result;
  }, {});
}

async function assertVendorActive(vendorId) {
  assertValidObjectId(vendorId, 'vendorId');
  const vendor = await vendorRepository.findById(vendorId);
  if (!vendor) throw notFound('Vendor not found');
  if (vendor.status !== recordStatuses.ACTIVE) throw conflict('Vendor is not active');
  return vendor;
}

async function assertProductTypeGroupActive(productTypeGroupId) {
  assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  let group;
  try {
    group = await catalogPublic.getProductTypeGroupById(productTypeGroupId);
  } catch (error) {
    if (error && error.code === 'RESOURCE_NOT_FOUND') throw notFound('Product type group not found');
    throw error;
  }
  if (!group) throw notFound('Product type group not found');
  if (group.status !== recordStatuses.ACTIVE) throw conflict('Product type group is not active');
  return group;
}

async function listVendors(query = {}) {
  const result = await vendorRepository.list(query);
  return toPaginatedResponse(result, toVendorDto);
}

async function getVendor(vendorId) {
  assertValidObjectId(vendorId, 'vendorId');
  const vendor = await vendorRepository.findById(vendorId);
  if (!vendor) throw notFound('Vendor not found');
  return toVendorDto(vendor, { detail: true });
}

async function createVendor(payload) {
  try {
    return toVendorDto(await vendorRepository.create({
      ...payload,
      code: normalizeCode(payload.code),
      fulfillmentType: normalizeCode(payload.fulfillmentType),
    }), { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor code already exists');
  }
}

async function updateVendor(vendorId, patch) {
  assertValidObjectId(vendorId, 'vendorId');
  const updatePatch = mutablePatch(patch, [
    'name',
    'providerKey',
    'fulfillmentType',
    'status',
    'metadata',
  ]);
  if (updatePatch.fulfillmentType) updatePatch.fulfillmentType = normalizeCode(updatePatch.fulfillmentType);

  try {
    const vendor = await vendorRepository.update(vendorId, updatePatch);
    if (!vendor) throw notFound('Vendor not found');
    return toVendorDto(vendor, { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor code already exists');
  }
}

async function getVendorById(vendorId, { includeInactive = false } = {}) {
  assertValidObjectId(vendorId, 'vendorId');
  const vendor = await vendorRepository.findById(vendorId);
  if (!vendor) return null;
  if (!includeInactive && vendor.status !== recordStatuses.ACTIVE) return null;
  return vendor;
}

async function findVendorByCode(code, { includeInactive = false } = {}) {
  const vendor = await vendorRepository.findByCode(normalizeCode(code));
  if (!vendor) return null;
  if (!includeInactive && vendor.status !== recordStatuses.ACTIVE) return null;
  return vendor;
}

async function attachCostCenterCounts(products = []) {
  return Promise.all(products.map(async (product) => ({
    product,
    costCenterCount: await costCenterRepository.countByProduct(product._id || product.id),
  })));
}

async function listVendorProducts(query = {}) {
  const result = await productRepository.list(query);
  const productsWithCounts = await attachCostCenterCounts(result.items);
  return toPaginatedResponse({
    ...result,
    items: productsWithCounts,
  }, ({ product, costCenterCount }) => toVendorProductDto(product, { costCenterCount }));
}

async function getVendorProduct(productId) {
  assertValidObjectId(productId, 'vendorProductId');
  const product = await productRepository.findById(productId);
  if (!product) throw notFound('Vendor product not found');
  const costCenterCount = await costCenterRepository.countByProduct(product._id || product.id);
  return toVendorProductDto(product, { detail: true, costCenterCount });
}

async function createVendorProduct(payload) {
  await Promise.all([
    assertVendorActive(payload.vendorId),
    assertProductTypeGroupActive(payload.productTypeGroupId),
  ]);

  try {
    return toVendorProductDto(await productRepository.create({
      ...payload,
      code: normalizeCode(payload.code),
    }), { detail: true, costCenterCount: 0 });
  } catch (error) {
    await mapDuplicate(error, 'Vendor product code already exists for this vendor');
  }
}

async function updateVendorProduct(productId, patch) {
  assertValidObjectId(productId, 'vendorProductId');
  const existing = await productRepository.findById(productId);
  if (!existing) throw notFound('Vendor product not found');

  const updatePatch = mutablePatch(patch, [
    'productTypeGroupId',
    'name',
    'externalProductId',
    'imageUrl',
    'productUrl',
    'designTemplateUrl',
    'minProductionDays',
    'maxProductionDays',
    'baseCostAmount',
    'currency',
    'status',
    'metadata',
  ]);

  if (updatePatch.productTypeGroupId) await assertProductTypeGroupActive(updatePatch.productTypeGroupId);

  try {
    const product = await productRepository.update(productId, updatePatch);
    const costCenterCount = await costCenterRepository.countByProduct(product._id || product.id);
    return toVendorProductDto(product, { detail: true, costCenterCount });
  } catch (error) {
    await mapDuplicate(error, 'Vendor product code already exists for this vendor');
  }
}

async function getVendorProductById(productId, { includeInactive = false } = {}) {
  assertValidObjectId(productId, 'vendorProductId');
  const product = await productRepository.findById(productId);
  if (!product) return null;
  if (!includeInactive && product.status !== recordStatuses.ACTIVE) return null;
  if (!includeInactive && product.vendorId && product.vendorId.status !== recordStatuses.ACTIVE) return null;
  return product;
}

async function findVendorProductByCode({ vendorId, code } = {}, { includeInactive = false } = {}) {
  assertValidObjectId(vendorId, 'vendorId');
  const product = await productRepository.findByCode({
    vendorId,
    code: normalizeCode(code),
    includeInactive,
  });
  if (!product) return null;
  if (!includeInactive && product.vendorId && product.vendorId.status !== recordStatuses.ACTIVE) return null;
  return product;
}

async function listActiveVendorProductsByProductTypeGroup(productTypeGroupId) {
  assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  const products = await productRepository.listActiveByProductTypeGroup(productTypeGroupId);
  return products.filter((product) => product.vendorId && product.vendorId.status === recordStatuses.ACTIVE);
}

async function assertActiveVendorProduct(productId) {
  const product = await getVendorProductById(productId);
  if (!product) throw notFound('Vendor product not found');
  return product;
}

async function listVendorCostCenters(productId, query = {}) {
  await assertActiveVendorProduct(productId);
  const result = await costCenterRepository.list({
    ...query,
    vendorProductId: productId,
  });
  return toPaginatedResponse(result, toVendorCostCenterDto);
}

async function createVendorCostCenter(productId, payload) {
  const product = await assertActiveVendorProduct(productId);

  try {
    return toVendorCostCenterDto(await costCenterRepository.create({
      ...payload,
      vendorProductId: productId,
      vendorId: product.vendorId._id || product.vendorId,
      code: normalizeCode(payload.code),
    }), { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor cost center code already exists for this product');
  }
}

async function updateVendorCostCenter(productId, costCenterId, patch) {
  await assertActiveVendorProduct(productId);
  assertValidObjectId(costCenterId, 'vendorCostCenterId');
  const existing = await costCenterRepository.findById(costCenterId);
  if (!existing || String(existing.vendorProductId) !== String(productId)) {
    throw notFound('Vendor cost center not found');
  }

  try {
    const costCenter = await costCenterRepository.update(costCenterId, mutablePatch(patch, [
      'name',
      'sku',
      'lngCode',
      'vendorSize',
      'vendorColor',
      'standardSize',
      'standardColor',
      'attributes',
      'weight',
      'weightUnit',
      'width',
      'length',
      'height',
      'dimensionUnit',
      'baseCostAmount',
      'currency',
      'domesticShipping',
      'internationalShipping',
      'priorityShipping',
      'importTaxAmount',
      'additionalCosts',
      'status',
      'metadata',
    ]));
    return toVendorCostCenterDto(costCenter, { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor cost center code already exists for this product');
  }
}

async function listActiveVendorCostCenters(productId) {
  await assertActiveVendorProduct(productId);
  return costCenterRepository.listActiveByProduct(productId);
}

async function findVendorCostCenterByCode({ vendorProductId, code } = {}, { includeInactive = false } = {}) {
  const product = await getVendorProductById(vendorProductId, { includeInactive });
  if (!product) return null;
  const costCenter = await costCenterRepository.findByProductAndCode({
    vendorProductId,
    code: normalizeCode(code),
  });
  if (!costCenter) return null;
  if (!includeInactive && costCenter.status !== recordStatuses.ACTIVE) return null;
  return costCenter;
}

module.exports = {
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  getVendorById,
  findVendorByCode,
  listVendorProducts,
  getVendorProduct,
  createVendorProduct,
  updateVendorProduct,
  getVendorProductById,
  findVendorProductByCode,
  listActiveVendorProductsByProductTypeGroup,
  listVendorCostCenters,
  createVendorCostCenter,
  updateVendorCostCenter,
  listActiveVendorCostCenters,
  findVendorCostCenterByCode,
  assertVendorActive,
  assertProductTypeGroupActive,
};
