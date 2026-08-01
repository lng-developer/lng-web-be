const { assertValidObjectId } = require('../../../shared/utils/objectId');
const catalogPublic = require('../../catalog/public');
const auditPublic = require('../../audit/public');
const crypto = require('crypto');
const logger = require('../../../shared/utils/logger');
const {
  recordStatuses,
  vendorIntegrationStatuses,
} = require('../constants/vendor.constants');
const vendorRepository = require('../repositories/vendor.repository');
const productRepository = require('../repositories/vendorProduct.repository');
const costCenterRepository = require('../repositories/vendorCostCenter.repository');
const integrationRepository = require('../repositories/vendorIntegrationConfig.repository');
const {
  toPaginatedResponse,
  toVendorDto,
  toVendorProductDto,
  toVendorCostCenterDto,
  toCompactVendor,
  toVendorIntegrationConfigDto,
} = require('../dtos/vendor.dto');
const {
  conflict,
  mapDuplicate,
  notFound,
  validationError,
} = require('./vendorError.helpers');

function normalizeCode(value) {
  return value === undefined || value === null ? value : String(value).trim().toUpperCase();
}

function normalizeString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function credentialKey() {
  const secret = process.env.VENDOR_CREDENTIAL_SECRET;
  if (!secret) throw validationError('VENDOR_CREDENTIAL_SECRET is required to store vendor credentials');
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value) return null;
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
    throw validationError('Vendor credential value is invalid');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function applyEncryptedSecret(patch, payload, inputField, encryptedField) {
  if (Object.prototype.hasOwnProperty.call(payload, inputField)) {
    patch[encryptedField] = encryptSecret(payload[inputField]);
  }
}

function mutablePatch(patch = {}, allowedFields = []) {
  return allowedFields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      result[field] = patch[field];
    }
    return result;
  }, {});
}

function auditSource(authContext = {}) {
  if (authContext.import) return 'IMPORT';
  if (authContext.worker) return 'WORKER';
  if (authContext.system) return 'SYSTEM';
  if (['HTTP', 'WORKER', 'SYSTEM', 'IMPORT'].includes(authContext.source)) return authContext.source;
  return 'HTTP';
}

function auditActor(authContext = {}) {
  const internal = authContext.system || authContext.worker || authContext.import;
  return {
    actorType: internal ? 'SYSTEM' : (authContext.accountId ? 'ACCOUNT' : 'SYSTEM'),
    actorAccountId: internal ? null : (authContext.accountId || null),
  };
}

function auditMutationIdentity(entity = {}, authContext = {}) {
  const lastHistory = Array.isArray(entity.statusHistory) ? entity.statusHistory.at(-1) : null;
  const persistedTimestamp = entity.updatedAt
    || lastHistory?.at
    || entity.createdAt
    || entity.submittedAt
    || entity.failedAt
    || entity.cancelledAt
    || entity.shippedAt
    || entity.deliveredAt;
  const internal = authContext.system || authContext.worker || authContext.import;
  const trustedOperationId = internal ? authContext.operationId : null;
  const material = Number.isInteger(entity.__v)
    ? `persisted-version:${entity.__v}`
    : persistedTimestamp
      ? `persisted-time:${new Date(persistedTimestamp).toISOString()}`
    : trustedOperationId
      ? `operation:${trustedOperationId}`
      : `persisted-state:${entity.status || 'unknown'}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

async function recordVendorOperation({
  action, entityType, entity, authContext = {}, changes = null, metadata = {},
}) {
  const entityId = String(entity._id || entity.id || entity);
  try {
    await auditPublic.record({
      ...auditActor(authContext),
      actorSnapshot: {},
      action,
      entityType,
      entityId,
      scopeType: null,
      scopeId: null,
      outcome: 'SUCCEEDED',
      source: auditSource(authContext),
      requestId: authContext.auditContext?.requestId || null,
      ipAddress: authContext.auditContext?.ipAddress || null,
      userAgent: authContext.auditContext?.userAgent || null,
      changes,
      metadata,
      deduplicationKey: `operations:${action.toLowerCase()}:${entityId}:${auditMutationIdentity(entity, authContext)}`,
    }, {});
  } catch (error) {
    logger.warn('vendor_audit_write_failed', { action, entityId, error });
  }
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

async function createVendor(payload, authContext) {
  try {
    const vendor = await vendorRepository.create({
      ...payload,
      code: normalizeCode(payload.code),
      fulfillmentType: normalizeCode(payload.fulfillmentType),
    });
    await recordVendorOperation({
      action: 'VENDOR_CREATED', entityType: 'VENDOR', entity: vendor, authContext,
      metadata: { code: vendor.code || normalizeCode(payload.code) },
    });
    return toVendorDto(vendor, { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor code already exists');
  }
}

async function updateVendor(vendorId, patch, authContext) {
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
    await recordVendorOperation({
      action: 'VENDOR_UPDATED', entityType: 'VENDOR', entity: vendor, authContext,
      changes: { fields: Object.keys(updatePatch) },
    });
    return toVendorDto(vendor, { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor code already exists');
  }
}

async function getVendorIntegrationConfig(vendorId, authContext = {}) {
  assertValidObjectId(vendorId, 'vendorId');
  const config = await integrationRepository.findByVendorId(vendorId);
  if (!config) throw notFound('Vendor integration config not found');
  const { actorType, actorAccountId } = auditActor(authContext);
  await auditPublic.record({
    actorType,
    actorAccountId,
    actorSnapshot: {},
    action: 'VENDOR_INTEGRATION_CONFIG_READ',
    entityType: 'VENDOR_INTEGRATION_CONFIG',
    entityId: String(config._id || config.id),
    scopeType: 'VENDOR',
    scopeId: String(vendorId),
    outcome: 'SUCCEEDED',
    source: auditSource(authContext),
    requestId: authContext.auditContext?.requestId || null,
    ipAddress: authContext.auditContext?.ipAddress || null,
    userAgent: authContext.auditContext?.userAgent || null,
    changes: null,
    metadata: { vendorId: String(vendorId), providerKey: config.providerKey || null },
    deduplicationKey: `vendor:integration_config_read:${crypto.randomUUID()}`,
  }, {});
  return toVendorIntegrationConfigDto(config);
}

async function updateVendorIntegrationConfig(vendorId, payload, authContext) {
  await assertVendorActive(vendorId);
  const providerKey = normalizeCode(payload.providerKey);
  const patch = {
    vendorId,
    providerKey,
    baseUrl: String(payload.baseUrl || '').trim().replace(/\/+$/, ''),
    authType: normalizeCode(payload.authType),
    expiresAt: payload.expiresAt || null,
    status: payload.status || vendorIntegrationStatuses.CONNECTED,
    lastError: null,
    metadata: payload.metadata || {},
  };

  applyEncryptedSecret(patch, payload, 'accessToken', 'accessTokenEncrypted');
  applyEncryptedSecret(patch, payload, 'refreshToken', 'refreshTokenEncrypted');
  applyEncryptedSecret(patch, payload, 'username', 'usernameEncrypted');
  applyEncryptedSecret(patch, payload, 'password', 'passwordEncrypted');

  try {
    const config = await integrationRepository.upsertByVendorAndProvider(patch);
    await recordVendorOperation({
      action: 'VENDOR_INTEGRATION_CONFIG_UPDATED',
      entityType: 'VENDOR_INTEGRATION_CONFIG',
      entity: config,
      authContext,
      changes: { fields: ['providerKey', 'baseUrl', 'authType', 'expiresAt', 'status', 'metadata'] },
      metadata: { vendorId: String(vendorId), providerKey },
    });
    return toVendorIntegrationConfigDto(config);
  } catch (error) {
    await mapDuplicate(error, 'Vendor integration config already exists');
  }
}

async function findIntegrationConfigByProvider(providerKey) {
  return integrationRepository.findByProviderKey(normalizeCode(providerKey));
}

function isCredentialExpiring(config) {
  if (!config?.expiresAt) return false;
  return new Date(config.expiresAt).getTime() <= Date.now() + (5 * 60 * 1000);
}

async function getVendorIntegrationCredential(vendorId, providerKey, { refreshIfExpiring = true } = {}) {
  assertValidObjectId(vendorId, 'vendorId');
  const normalizedProvider = normalizeCode(providerKey);
  const config = await integrationRepository.findByVendorId(vendorId);
  if (!config || config.status !== vendorIntegrationStatuses.CONNECTED) return null;
  if (config.providerKey !== normalizedProvider) {
    throw validationError('Provider key does not match vendor integration config');
  }
  if (refreshIfExpiring && isCredentialExpiring(config)) {
    return refreshIntegrationConfig(config);
  }
  const accessToken = decryptSecret(config.accessTokenEncrypted);
  if (!accessToken) return null;
  return {
    providerKey: config.providerKey,
    vendorId: String(config.vendorId?._id || config.vendorId),
    baseUrl: config.baseUrl,
    authType: config.authType,
    accessToken,
    expiresAt: config.expiresAt || null,
    status: config.status,
    metadata: config.metadata || {},
  };
}

function responseErrorMessage(body, fallback) {
  return body?.message || body?.error || body?.errors?.[0]?.message || fallback;
}

async function requestCredentialRefresh(config) {
  const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
  if (config.providerKey === 'PRINTWAY') {
    const refreshToken = decryptSecret(config.refreshTokenEncrypted);
    if (!refreshToken) throw validationError('Printway refresh token is not configured');
    const url = new URL(`${baseUrl}/auth/refresh-token`);
    url.searchParams.set('refresh_token', refreshToken);
    const response = await fetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw conflict(responseErrorMessage(body, 'Printway token refresh failed'));
    }
    return {
      accessToken: body.access_token || body.accessToken || body.data?.access_token || body.data?.token,
      expiresAt: body.expires_at || body.expiresAt || body.data?.expires_at || null,
    };
  }

  if (config.providerKey === 'LENFUL') {
    const username = decryptSecret(config.usernameEncrypted);
    const password = decryptSecret(config.passwordEncrypted);
    if (!username || !password) throw validationError('Lenful username/password is not configured');
    const params = new URLSearchParams({ user_name: username, password });
    const response = await fetch(`${baseUrl}/seller/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw conflict(responseErrorMessage(body, 'Lenful login failed'));
    }
    return {
      accessToken: body.access_token || body.accessToken || body.token || body.data?.access_token || body.data?.token,
      expiresAt: body.expires_at || body.expiresAt || body.data?.expires_at || null,
    };
  }

  return { accessToken: decryptSecret(config.accessTokenEncrypted), expiresAt: config.expiresAt || null };
}

async function refreshIntegrationConfig(config, authContext = { system: true }) {
  const refreshed = await requestCredentialRefresh(config);
  if (!refreshed.accessToken) throw conflict('Vendor credential refresh did not return an access token');

  const updated = await integrationRepository.update(config._id || config.id, {
    accessTokenEncrypted: encryptSecret(refreshed.accessToken),
    expiresAt: refreshed.expiresAt || null,
    status: vendorIntegrationStatuses.CONNECTED,
    lastCheckedAt: new Date(),
    lastError: null,
  });
  await recordVendorOperation({
    action: 'VENDOR_INTEGRATION_CREDENTIAL_ROTATED',
    entityType: 'VENDOR_INTEGRATION_CONFIG',
    entity: updated,
    authContext,
    changes: { fields: ['accessTokenEncrypted', 'expiresAt', 'status', 'lastCheckedAt'] },
    metadata: { vendorId: String(updated.vendorId?._id || updated.vendorId), providerKey: updated.providerKey },
  });

  return {
    providerKey: updated.providerKey,
    vendorId: String(updated.vendorId?._id || updated.vendorId),
    baseUrl: updated.baseUrl,
    authType: updated.authType,
    accessToken: refreshed.accessToken,
    expiresAt: updated.expiresAt || null,
    status: updated.status,
    metadata: updated.metadata || {},
  };
}

async function refreshVendorIntegrationCredential(providerKey, authContext) {
  const config = await findIntegrationConfigByProvider(providerKey);
  if (!config) throw notFound('Vendor integration config not found');
  return refreshIntegrationConfig(config, authContext);
}

async function refreshVendorIntegrationCredentialForVendor(vendorId, providerKey, authContext) {
  assertValidObjectId(vendorId, 'vendorId');
  const config = await integrationRepository.findByVendorId(vendorId);
  if (!config) throw notFound('Vendor integration config not found');
  if (providerKey && config.providerKey !== normalizeCode(providerKey)) {
    throw validationError('Provider key does not match vendor integration config');
  }
  return refreshIntegrationConfig(config, authContext);
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

async function createVendorProduct(payload, authContext) {
  await Promise.all([
    assertVendorActive(payload.vendorId),
    assertProductTypeGroupActive(payload.productTypeGroupId),
  ]);

  try {
    const product = await productRepository.create({
      ...payload,
      code: normalizeCode(payload.code),
    });
    await recordVendorOperation({
      action: 'VENDOR_PRODUCT_CREATED', entityType: 'VENDOR_PRODUCT', entity: product, authContext,
      metadata: { vendorId: String(payload.vendorId), productTypeGroupId: String(payload.productTypeGroupId) },
    });
    return toVendorProductDto(product, { detail: true, costCenterCount: 0 });
  } catch (error) {
    await mapDuplicate(error, 'Vendor product code already exists for this vendor');
  }
}

async function updateVendorProduct(productId, patch, authContext) {
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
    await recordVendorOperation({
      action: 'VENDOR_PRODUCT_UPDATED', entityType: 'VENDOR_PRODUCT', entity: product, authContext,
      changes: { fields: Object.keys(updatePatch) },
      metadata: { vendorId: String(product.vendorId?._id || product.vendorId || '') || null },
    });
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

async function createVendorCostCenter(productId, payload, authContext) {
  const product = await assertActiveVendorProduct(productId);

  try {
    const costCenter = await costCenterRepository.create({
      ...payload,
      vendorProductId: productId,
      vendorId: product.vendorId._id || product.vendorId,
      code: normalizeCode(payload.code),
    });
    await recordVendorOperation({
      action: 'VENDOR_COST_CENTER_CREATED', entityType: 'VENDOR_COST_CENTER', entity: costCenter, authContext,
      metadata: { vendorId: String(product.vendorId._id || product.vendorId), vendorProductId: String(productId) },
    });
    return toVendorCostCenterDto(costCenter, { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor cost center code already exists for this product');
  }
}

async function updateVendorCostCenter(productId, costCenterId, patch, authContext) {
  await assertActiveVendorProduct(productId);
  assertValidObjectId(costCenterId, 'vendorCostCenterId');
  const existing = await costCenterRepository.findById(costCenterId);
  if (!existing || String(existing.vendorProductId) !== String(productId)) {
    throw notFound('Vendor cost center not found');
  }

  try {
    const updatePatch = mutablePatch(patch, [
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
    ]);
    const costCenter = await costCenterRepository.update(costCenterId, updatePatch);
    await recordVendorOperation({
      action: 'VENDOR_COST_CENTER_UPDATED', entityType: 'VENDOR_COST_CENTER', entity: costCenter, authContext,
      changes: { fields: Object.keys(updatePatch) },
      metadata: { vendorId: String(existing.vendorId || '') || null, vendorProductId: String(productId) },
    });
    return toVendorCostCenterDto(costCenter, { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Vendor cost center code already exists for this product');
  }
}

async function listActiveVendorCostCenters(productId) {
  await assertActiveVendorProduct(productId);
  return costCenterRepository.listActiveByProduct(productId);
}

async function listActiveVendorCostCentersByProductIds(productIds = []) {
  const uniqueProductIds = [...new Set((productIds || []).filter(Boolean).map(String))];
  uniqueProductIds.forEach((productId) => assertValidObjectId(productId, 'vendorProductId'));
  if (!uniqueProductIds.length) return [];

  const products = await productRepository.listActiveByIds(uniqueProductIds);
  const activeProductIds = products
    .filter((product) => product.vendorId && product.vendorId.status === recordStatuses.ACTIVE)
    .map((product) => String(product._id || product.id));

  return costCenterRepository.listActiveByProducts(activeProductIds);
}

function toVendorCostCenterCandidateDto(row = {}) {
  return {
    vendor: toCompactVendor(row.vendor),
    vendorProduct: toVendorProductDto(row.vendorProduct),
    vendorCostCenter: toVendorCostCenterDto(row.vendorCostCenter),
  };
}

async function searchVendorCostCenters(query = {}) {
  ['vendorId', 'vendorProductId', 'productTypeGroupId'].forEach((field) => {
    if (query[field]) assertValidObjectId(query[field], field);
  });
  const result = await costCenterRepository.search({
    ...query,
    status: recordStatuses.ACTIVE,
  });
  return toPaginatedResponse(result, toVendorCostCenterCandidateDto);
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
  getVendorIntegrationConfig,
  updateVendorIntegrationConfig,
  getVendorIntegrationCredential,
  refreshVendorIntegrationCredential,
  refreshVendorIntegrationCredentialForVendor,
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
  listActiveVendorCostCentersByProductIds,
  searchVendorCostCenters,
  findVendorCostCenterByCode,
  assertVendorActive,
  assertProductTypeGroupActive,
};
