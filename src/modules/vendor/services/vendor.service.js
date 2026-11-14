const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { isDeepStrictEqual } = require('util');
const catalogPublic = require('../../catalog/public');
const auditPublic = require('../../audit/public');
const crypto = require('crypto');
const logger = require('../../../shared/utils/logger');
const {
  recordStatuses,
  vendorIntegrationModes,
  vendorIntegrationStatuses,
  nativeVendorProviderKeys,
} = require('../constants/vendor.constants');
const vendorRepository = require('../repositories/vendor.repository');
const productRepository = require('../repositories/vendorProduct.repository');
const costCenterRepository = require('../repositories/vendorCostCenter.repository');
const integrationRepository = require('../repositories/vendorIntegrationConfig.repository');
const migrationReviewRepository = require('../repositories/vendorMigrationReview.repository');
const integrationAdapterRegistry = require('./vendorIntegrationAdapterRegistry.service');
const {
  toPaginatedResponse,
  toVendorDto,
  toVendorProductDto,
  toVendorCostCenterDto,
  toCompactVendor,
  toVendorIntegrationConfigDto,
  toLenfulOrderDto,
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

function resolveIntegrationMode(payload = {}) {
  const requestedMode = normalizeCode(payload.mode);
  if (requestedMode) return requestedMode;
  const legacyProvider = normalizeCode(payload.providerKey);
  if (legacyProvider === 'CUSTOM') return vendorIntegrationModes.GENERIC_API;
  if (legacyProvider) return vendorIntegrationModes.NATIVE;
  return vendorIntegrationModes.MANUAL;
}

const costRateFields = Object.freeze([
  'baseCostAmount',
  'unitSurchargeAmount',
  'currency',
  'domesticShipping',
  'internationalShipping',
  'priorityShipping',
  'importTaxAmount',
  'additionalCosts',
]);

function pickCostRateFields(source = {}) {
  return Object.fromEntries(costRateFields
    .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
    .map((field) => [field, source[field]]));
}

function initialCostRate(costCenter = {}) {
  return {
    version: 1,
    effectiveFrom: new Date(0),
    effectiveTo: null,
    ...pickCostRateFields(costCenter),
  };
}

function appendCostRate(costCenter, patch) {
  const effectiveFrom = new Date(patch.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) throw validationError('COST_RATE_EFFECTIVE_FROM_REQUIRED');

  const rates = (costCenter.costRateHistory?.length ? costCenter.costRateHistory : [initialCostRate(costCenter)])
    .map((rate) => ({ ...rate }))
    .sort((left, right) => new Date(left.effectiveFrom) - new Date(right.effectiveFrom));
  const previous = rates.at(-1);
  const previousEffectiveFrom = new Date(previous.effectiveFrom);
  if (effectiveFrom <= previousEffectiveFrom || previous.effectiveTo) {
    throw validationError('COST_RATE_EFFECTIVE_FROM_MUST_BE_LATER');
  }
  const changes = pickCostRateFields(patch);
  if (!Object.keys(changes).length || Object.entries(changes)
    .every(([field, value]) => isDeepStrictEqual(previous[field], value))) {
    throw validationError('COST_RATE_CHANGE_REQUIRED');
  }

  const next = {
    ...previous,
    ...changes,
    version: (previous.version || rates.length) + 1,
    effectiveFrom,
    effectiveTo: null,
  };
  previous.effectiveTo = new Date(effectiveFrom.getTime() - 1);
  return [...rates.slice(0, -1), previous, next];
}

function selectCostRate(costCenter = {}, orderedAt) {
  const date = new Date(orderedAt);
  if (Number.isNaN(date.getTime())) throw validationError('COST_RATE_ORDERED_AT_REQUIRED');
  const rates = costCenter.costRateHistory?.length
    ? costCenter.costRateHistory
    : [initialCostRate(costCenter)];
  const matches = rates.filter((rate) => new Date(rate.effectiveFrom) <= date
    && (!rate.effectiveTo || date <= new Date(rate.effectiveTo)));
  if (matches.length !== 1) throw validationError(matches.length ? 'COST_RATE_AMBIGUOUS' : 'COST_RATE_NOT_FOUND');
  return matches[0];
}

function normalizeString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function csvCell(value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function importText(row, key) {
  const value = row?.[key];
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function importInteger(row, key) {
  const value = importText(row, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw validationError(`${key} must be a non-negative integer`);
  return parsed;
}

function importNumber(row, key) {
  const value = importText(row, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw validationError(`${key} must be a non-negative number`);
  return parsed;
}

function importStatus(row, key) {
  const value = importText(row, key);
  if (value === undefined) return undefined;
  const status = value.toUpperCase();
  if (!Object.values(recordStatuses).includes(status)) throw validationError(`${key} is invalid`);
  return status;
}

function toId(value) {
  return String(value?._id || value || '');
}

function idEquals(left, right) {
  return toId(left) === toId(right);
}

function assertProductionDaysRange(payload = {}) {
  const min = payload.minProductionDays;
  const max = payload.maxProductionDays;
  if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
    throw validationError('minProductionDays must be less than or equal to maxProductionDays', {
      field: 'minProductionDays',
    });
  }
}

const requiredCredentialFields = Object.freeze({
  API_KEY: ['accessToken'],
  ACCESS_REFRESH: ['accessToken', 'refreshToken'],
  LOGIN_PASSWORD: ['username', 'password'],
});

function assertRequiredCredentials(payload, authType, adapterKey) {
  if (adapterKey === 'MERCHFOX') {
    const missing = ['apiKey', 'apiSecret'].filter((field) => !normalizeString(payload[field]));
    if (missing.length) throw validationError(`${missing.join(', ')} is required`);
    return;
  }
  const missing = (requiredCredentialFields[authType] || [])
    .filter((field) => !normalizeString(payload[field]));
  if (missing.length) throw validationError(`${missing.join(', ')} is required`);
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

function patchMatches(current, proposed) {
  if (proposed === undefined) return true;
  if (proposed === null || typeof proposed !== 'object') return current === proposed;
  return Object.entries(proposed).every(([key, value]) => patchMatches(current?.[key], value));
}

function hasPatchChanges(current, patch) {
  return Object.entries(patch).some(([key, value]) => !patchMatches(current?.[key], value));
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
  action, entityType, entity, authContext = {}, changes = null, metadata = {}, outcome = 'SUCCEEDED',
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
      outcome,
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
    'unitSurchargeAmount',
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
  if (!config) return null;
  return toVendorIntegrationConfigDto(config);
}

async function getVendorIntegrationAssignment(vendorId) {
  assertValidObjectId(vendorId, 'vendorId');
  const config = await integrationRepository.findByVendorId(vendorId);
  if (!config) return null;
  const mode = config.mode
    || (config.providerKey === 'CUSTOM' ? vendorIntegrationModes.GENERIC_API : config.providerKey
      ? vendorIntegrationModes.NATIVE : vendorIntegrationModes.MANUAL);
  return {
    vendorId: String(config.vendorId?._id || config.vendorId || vendorId),
    mode,
    adapterKey: config.adapterKey || (mode === vendorIntegrationModes.NATIVE ? config.providerKey || null : null),
    providerKey: config.providerKey || null,
    status: config.status || vendorIntegrationStatuses.DISCONNECTED,
  };
}

async function testVendorIntegrationConnection(vendorId, authContext = {}) {
  await assertVendorActive(vendorId);
  const config = await integrationRepository.findByVendorId(vendorId);
  if (!config) throw notFound('Vendor integration config not found');

  const mode = config.mode
    || (config.providerKey === 'CUSTOM' ? vendorIntegrationModes.GENERIC_API : config.providerKey
      ? vendorIntegrationModes.NATIVE : vendorIntegrationModes.MANUAL);
  const adapterKey = config.adapterKey
    || (mode === vendorIntegrationModes.NATIVE ? config.providerKey : null);
  if (mode !== vendorIntegrationModes.NATIVE) {
    throw validationError('Only Native vendor integrations can be tested');
  }

  const adapter = integrationAdapterRegistry.getAdapter(adapterKey);
  if (!adapter) {
    throw validationError('Vendor integration adapter is not implemented', { provider: adapterKey });
  }

  const configId = config._id || config.id;
  const checkedAt = new Date();
  try {
    let accessToken = decryptSecret(config.accessTokenEncrypted);
    let expiresAt = config.expiresAt || null;
    if (!accessToken && ['PRINTWAY', 'LENFUL'].includes(adapter.provider)) {
      const refreshed = await refreshIntegrationConfig(config, authContext);
      accessToken = refreshed.accessToken;
      expiresAt = refreshed.expiresAt || null;
    }
    const apiKey = decryptSecret(config.apiKeyEncrypted);
    const apiSecret = decryptSecret(config.apiSecretEncrypted);
    if (adapter.provider === 'MERCHFOX' && (!apiKey || !apiSecret)) throw validationError('Merchfox API credentials are not configured');
    if (adapter.provider !== 'MERCHFOX' && !accessToken) throw validationError('Vendor integration credentials are not configured');

    const credential = {
      providerKey: adapter.provider,
      vendorId: String(config.vendorId?._id || config.vendorId || vendorId),
      baseUrl: config.baseUrl,
      authType: config.authType,
      accessToken,
      apiKey,
      apiSecret,
      expiresAt,
      metadata: config.metadata || {},
    };
    await adapter.testConnection({ credential });
    const updated = await integrationRepository.update(configId, {
      status: vendorIntegrationStatuses.CONNECTED,
      lastCheckedAt: checkedAt,
      lastError: null,
    });
    await recordVendorOperation({
      action: 'VENDOR_INTEGRATION_CONNECTION_TESTED',
      entityType: 'VENDOR_INTEGRATION_CONFIG',
      entity: updated || config,
      authContext,
      changes: { fields: ['status', 'lastCheckedAt', 'lastError'] },
      metadata: { vendorId: String(vendorId), providerKey: adapter.provider },
    });
    return toVendorIntegrationConfigDto(updated || { ...config, status: vendorIntegrationStatuses.CONNECTED });
  } catch (error) {
    try {
      const failed = await integrationRepository.update(configId, {
        status: vendorIntegrationStatuses.DISCONNECTED,
        lastCheckedAt: checkedAt,
        lastError: 'Connection test failed',
      });
      await recordVendorOperation({
        action: 'VENDOR_INTEGRATION_CONNECTION_TESTED',
        entityType: 'VENDOR_INTEGRATION_CONFIG',
        entity: failed || config,
        authContext,
        changes: { fields: ['status', 'lastCheckedAt', 'lastError'] },
        metadata: { vendorId: String(vendorId), providerKey: adapter.provider, reason: 'CONNECTION_TEST_FAILED' },
        outcome: 'FAILED',
      });
    } catch (persistenceError) {
      logger.warn('vendor_connection_test_status_update_failed', {
        vendorId: String(vendorId),
        providerKey: adapter.provider,
        error: persistenceError,
      });
    }
    throw validationError('Vendor integration connection test failed', { provider: adapter.provider });
  }
}

async function updateVendorIntegrationConfig(vendorId, payload, authContext) {
  await assertVendorActive(vendorId);
  const existing = await integrationRepository.findByVendorId(vendorId);
  const mode = resolveIntegrationMode(payload);
  if (!Object.values(vendorIntegrationModes).includes(mode)) {
    throw validationError('Invalid vendor integration mode');
  }
  const adapterKey = mode === vendorIntegrationModes.NATIVE
    ? normalizeCode(payload.adapterKey || payload.providerKey)
    : null;
  if (mode === vendorIntegrationModes.NATIVE && !nativeVendorProviderKeys.includes(adapterKey)) {
    throw validationError('Native adapterKey is required');
  }
  const providerKey = mode === vendorIntegrationModes.NATIVE ? adapterKey
    : mode === vendorIntegrationModes.GENERIC_API ? 'CUSTOM' : null;
  const authType = mode === vendorIntegrationModes.MANUAL ? null : normalizeCode(payload.authType);
  if (mode !== vendorIntegrationModes.MANUAL) {
    if (!String(payload.baseUrl || '').trim()) throw validationError('baseUrl is required');
    if (!authType) throw validationError('authType is required');
  }
  const existingMode = existing?.mode
    || (existing?.providerKey === 'CUSTOM' ? vendorIntegrationModes.GENERIC_API
      : existing?.providerKey ? vendorIntegrationModes.NATIVE : vendorIntegrationModes.MANUAL);
  const existingAdapterKey = existing?.adapterKey
    || (existingMode === vendorIntegrationModes.NATIVE ? existing?.providerKey : null);
  const credentialsMustChange = !existing
    || existingMode !== mode
    || existingAdapterKey !== adapterKey
    || existing.providerKey !== providerKey
    || existing.authType !== authType;
  if (credentialsMustChange && mode !== vendorIntegrationModes.MANUAL) {
    assertRequiredCredentials(payload, authType, adapterKey);
  }
  const patch = {
    vendorId,
    mode,
    adapterKey,
    providerKey,
    baseUrl: mode === vendorIntegrationModes.MANUAL
      ? null
      : String(payload.baseUrl || '').trim().replace(/\/+$/, ''),
    orderEndpointUrl: mode === vendorIntegrationModes.MANUAL || !payload.orderEndpointUrl
      ? null
      : String(payload.orderEndpointUrl).trim().replace(/\/+$/, ''),
    trackingEndpointUrl: mode === vendorIntegrationModes.MANUAL || !payload.trackingEndpointUrl
      ? null
      : String(payload.trackingEndpointUrl).trim().replace(/\/+$/, ''),
    pushOrderEndpointUrl: mode === vendorIntegrationModes.MANUAL || !payload.pushOrderEndpointUrl
      ? null
      : String(payload.pushOrderEndpointUrl).trim().replace(/\/+$/, ''),
    authType,
    expiresAt: payload.expiresAt || null,
    status: mode === vendorIntegrationModes.MANUAL
      ? vendorIntegrationStatuses.DISCONNECTED
      : credentialsMustChange
      ? vendorIntegrationStatuses.DISCONNECTED
      : (payload.status || existing.status),
    lastError: null,
    metadata: payload.metadata || {},
  };

  if (credentialsMustChange) {
    Object.assign(patch, {
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      usernameEncrypted: null,
      passwordEncrypted: null,
      apiKeyEncrypted: null,
      apiSecretEncrypted: null,
    });
  }

  applyEncryptedSecret(patch, payload, 'accessToken', 'accessTokenEncrypted');
  applyEncryptedSecret(patch, payload, 'refreshToken', 'refreshTokenEncrypted');
  applyEncryptedSecret(patch, payload, 'username', 'usernameEncrypted');
  applyEncryptedSecret(patch, payload, 'password', 'passwordEncrypted');
  applyEncryptedSecret(patch, payload, 'apiKey', 'apiKeyEncrypted');
  applyEncryptedSecret(patch, payload, 'apiSecret', 'apiSecretEncrypted');

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

async function deleteVendorIntegrationConfig(vendorId, authContext = {}) {
  assertValidObjectId(vendorId, 'vendorId');
  const existing = await integrationRepository.findByVendorId(vendorId);
  if (!existing) return { deleted: false };
  const deleted = await integrationRepository.deleteByVendorId(vendorId);
  if (!deleted) return { deleted: false };
  await recordVendorOperation({
    action: 'VENDOR_INTEGRATION_CONFIG_DELETED',
    entityType: 'VENDOR_INTEGRATION_CONFIG',
    entity: existing,
    authContext,
    changes: { fields: ['providerKey', 'baseUrl', 'authType', 'expiresAt', 'status', 'metadata'] },
    metadata: { vendorId: String(vendorId), providerKey: existing.providerKey || null },
  });
  return { deleted: true };
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
  const configuredProvider = normalizeCode(config.adapterKey || config.providerKey);
  if (configuredProvider !== normalizedProvider) {
    throw validationError('Provider key does not match vendor integration config');
  }
  if (refreshIfExpiring && isCredentialExpiring(config)) {
    return refreshIntegrationConfig(config);
  }
  const accessToken = decryptSecret(config.accessTokenEncrypted);
  const apiKey = decryptSecret(config.apiKeyEncrypted);
  const apiSecret = decryptSecret(config.apiSecretEncrypted);
  if (configuredProvider === 'MERCHFOX' ? (!apiKey || !apiSecret) : !accessToken) return null;
  return {
    providerKey: configuredProvider,
    vendorId: String(config.vendorId?._id || config.vendorId),
    baseUrl: config.baseUrl,
    orderEndpointUrl: config.orderEndpointUrl || null,
    trackingEndpointUrl: config.trackingEndpointUrl || null,
    pushOrderEndpointUrl: config.pushOrderEndpointUrl || null,
    authType: config.authType,
    accessToken,
    apiKey,
    apiSecret,
    expiresAt: config.expiresAt || null,
    status: config.status,
    metadata: config.metadata || {},
  };
}

async function getLenfulReadCredential(vendorId) {
  const credential = await getVendorIntegrationCredential(vendorId, 'LENFUL', { refreshIfExpiring: false });
  if (!credential) throw validationError('Connected Lenful credentials are required');
  return credential;
}

async function getMerchizeReadCredential(vendorId) {
  const credential = await getVendorIntegrationCredential(vendorId, 'MERCHIZE', { refreshIfExpiring: false });
  if (!credential) throw validationError('Connected Merchize credentials are required');
  return credential;
}

async function getMerchizeCatalog(vendorId, query = {}) {
  await assertVendorActive(vendorId);
  const adapter = integrationAdapterRegistry.getAdapter('MERCHIZE');
  if (!adapter?.fetchCatalog) throw validationError('Merchize catalog adapter is not implemented');
  return adapter.fetchCatalog({ credential: await getMerchizeReadCredential(vendorId), query });
}

async function importMerchizeCatalogProducts({ vendorId, products = [], tierName = 'tier1' } = {}, authContext) {
  if (!vendorId) throw validationError('vendorId is required');
  assertValidObjectId(vendorId, 'vendorId');
  await assertVendorActive(vendorId);

  const flatRows = [];
  const selectedTier = String(tierName || 'tier1').trim().toLowerCase();

  for (const product of products) {
    const productCode = String(product.sku || '').trim();
    const productName = String(product.title || '').trim();
    if (!productCode || !productName) continue;

    const variants = Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants
      : [{ sku: `${productCode}-DEFAULT` }];

    for (const variant of variants) {
      const variantSku = String(variant.sku || '').trim() || `${productCode}-DEFAULT`;

      let size = '';
      let color = '';
      const attributes = Array.isArray(variant.attributes) ? variant.attributes : [];
      for (const attr of attributes) {
        const attrType = String(attr.type || attr.name || '').toLowerCase();
        const val = String(attr.value_text || attr.value || attr.text || '').trim();
        if (attrType.includes('size')) {
          size = val;
        } else if (attrType.includes('color')) {
          color = val;
        }
      }

      let baseCostAmount = 0;
      if (Array.isArray(variant.tiers) && variant.tiers.length > 0) {
        const matchedTier = variant.tiers.find((t) => String(t.name || '').trim().toLowerCase() === selectedTier)
          || variant.tiers.find((t) => String(t.name || '').trim().toLowerCase().includes('tier1'))
          || variant.tiers[0];
        if (matchedTier && matchedTier.price !== undefined && matchedTier.price !== null) {
          baseCostAmount = Number(matchedTier.price);
        }
      }

      let domesticEconomyAmount = 0;
      let domesticAdditionalAmount = 0;
      let internationalEconomyAmount = 0;
      let internationalAdditionalAmount = 0;

      if (Array.isArray(variant.shipping_prices)) {
        for (const sp of variant.shipping_prices) {
          const zone = String(sp.to_zone || '').trim().toUpperCase();
          if (zone === 'US') {
            domesticEconomyAmount = Number(sp.first_item || 0);
            domesticAdditionalAmount = Number(sp.additional_item || 0);
          } else if (zone === 'ROW' || zone === 'ALL' || zone === 'EU') {
            if (!internationalEconomyAmount) {
              internationalEconomyAmount = Number(sp.first_item || 0);
              internationalAdditionalAmount = Number(sp.additional_item || 0);
            }
          }
        }
      }

      const printMethod = Array.isArray(product.printing_methods) && product.printing_methods.length > 0
        ? product.printing_methods[0]
        : '';

      flatRows.push({
        code: productCode,
        name: productName,
        size,
        color,
        sku: variantSku,
        costCenterCode: variantSku,
        baseCostAmount: String(baseCostAmount.toFixed(2)),
        domesticEconomyAmount: String(domesticEconomyAmount.toFixed(2)),
        domesticAdditionalAmount: String(domesticAdditionalAmount.toFixed(2)),
        internationalEconomyAmount: String(internationalEconomyAmount.toFixed(2)),
        internationalAdditionalAmount: String(internationalAdditionalAmount.toFixed(2)),
        printMethod,
        currency: 'USD',
        status: 'ACTIVE',
      });
    }
  }

  const result = await importVendorProductsUnified({ vendorId, rows: flatRows }, authContext);

  await recordVendorOperation({
    action: 'VENDOR_CATALOG_SYNCED',
    entityType: 'VENDOR_PRODUCT',
    entity: `merchize-catalog-import:${vendorId}`,
    authContext,
    metadata: {
      vendorId: String(vendorId),
      providerKey: 'MERCHIZE',
      productCount: products.length,
      importedRows: flatRows.length,
      ...result,
    },
  });

  return result;
}

async function getLenfulCatalog(vendorId, query = {}) {
  const adapter = integrationAdapterRegistry.getAdapter('LENFUL');
  if (!adapter?.fetchCatalog) throw validationError('Lenful catalog adapter is not implemented');
  return adapter.fetchCatalog({ credential: await getLenfulReadCredential(vendorId), query });
}

async function getLenfulTracking(vendorId, externalOrderId) {
  const adapter = integrationAdapterRegistry.getAdapter('LENFUL');
  if (!adapter?.fetchTracking) throw validationError('Lenful tracking adapter is not implemented');
  return adapter.fetchTracking({ credential: await getLenfulReadCredential(vendorId), externalOrderId });
}

async function getLenfulOrder(vendorId, orderNumber) {
  const adapter = integrationAdapterRegistry.getAdapter('LENFUL');
  if (!adapter?.fetchOrder) throw validationError('Lenful order adapter is not implemented');
  const order = await adapter.fetchOrder({ credential: await getLenfulReadCredential(vendorId), orderNumber });
  if (!order) throw notFound('Lenful order not found');
  return toLenfulOrderDto(order);
}

async function getVendorProductionLines(vendorId, providerKey) {
  const credential = await getVendorIntegrationCredential(vendorId, providerKey, { refreshIfExpiring: false });
  const adapter = integrationAdapterRegistry.getAdapter(providerKey);
  if (!adapter?.fetchProductionLines) throw validationError('Production line lookup is not supported for this vendor');
  if (!credential) throw validationError('Connected vendor credentials are required');
  return adapter.fetchProductionLines({ credential });
}

function responseErrorMessage(body, fallback) {
  return body?.message || body?.error || body?.errors?.[0]?.message || fallback;
}

async function requestCredentialRefresh(config) {
  const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
  const providerKey = normalizeCode(config.adapterKey || config.providerKey);
  if (providerKey === 'PRINTWAY') {
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

  if (providerKey === 'LENFUL') {
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

  throw validationError(`Credential verification is not supported for ${providerKey}`);
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
    providerKey: normalizeCode(updated.adapterKey || updated.providerKey),
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
  if (providerKey && normalizeCode(config.adapterKey || config.providerKey) !== normalizeCode(providerKey)) {
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

async function findVendorByLegacyId(legacyId) {
  return vendorRepository.findByLegacyId(legacyId);
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

async function* exportVendorCatalog() {
  const headers = [
    'vendorCode', 'productId', 'productTypeGroupId', 'productCode', 'productName', 'productExternalId',
    'productImageUrl', 'productUrl', 'designTemplateUrl', 'minProductionDays', 'maxProductionDays',
    'productBaseCostAmount', 'productCurrency', 'productStatus', 'costCenterId', 'costCenterCode',
    'costCenterName', 'sku', 'lngCode', 'vendorSize', 'vendorColor', 'standardSize', 'standardColor',
    'printMethod', 'weight', 'weightUnit', 'width', 'length', 'height', 'dimensionUnit', 'baseCostAmount',
    'currency', 'domesticEconomyAmount', 'domesticAdditionalAmount', 'internationalEconomyAmount',
    'internationalAdditionalAmount', 'priorityEconomyAmount', 'priorityAdditionalAmount', 'importTaxAmount',
    'embroideryAmount', 'twoSidedPrintAmount', 'twoPositionPrintAmount', 'costCenterStatus',
  ];
  yield `\uFEFF${headers.map(csvCell).join(',')}\n`;
  const costCenterCursor = costCenterRepository.cursorAllForExport();
  let nextCostCenter = await costCenterCursor.next();
  for await (const product of productRepository.cursorAllForExport()) {
    const productId = toId(product);
    while (nextCostCenter && toId(nextCostCenter.vendorProductId) < productId) {
      nextCostCenter = await costCenterCursor.next();
    }
    const base = [
      product.vendorId?.code || '', productId, toId(product.productTypeGroupId), product.code, product.name,
      product.externalProductId, product.imageUrl, product.productUrl, product.designTemplateUrl,
      product.minProductionDays, product.maxProductionDays, product.baseCostAmount, product.currency, product.status,
    ];
    let wroteCostCenter = false;
    while (nextCostCenter && toId(nextCostCenter.vendorProductId) === productId) {
      const costCenter = nextCostCenter;
      yield `${[...base, [
      toId(costCenter), costCenter.code, costCenter.name, costCenter.sku, costCenter.lngCode,
      costCenter.vendorSize, costCenter.vendorColor, costCenter.standardSize, costCenter.standardColor,
      costCenter.printMethod, costCenter.weight, costCenter.weightUnit, costCenter.width, costCenter.length,
      costCenter.height, costCenter.dimensionUnit, costCenter.baseCostAmount, costCenter.currency,
      costCenter.domesticShipping?.economyAmount, costCenter.domesticShipping?.additionalAmount,
      costCenter.internationalShipping?.economyAmount, costCenter.internationalShipping?.additionalAmount,
      costCenter.priorityShipping?.economyAmount, costCenter.priorityShipping?.additionalAmount,
      costCenter.importTaxAmount, costCenter.additionalCosts?.embroideryAmount,
      costCenter.additionalCosts?.twoSidedPrintAmount, costCenter.additionalCosts?.twoPositionPrintAmount,
      costCenter.status,
      ]].flat().map(csvCell).join(',')}\n`;
      wroteCostCenter = true;
      nextCostCenter = await costCenterCursor.next();
    }
    if (!wroteCostCenter) yield `${[...base, ...Array(headers.length - base.length).fill('')].map(csvCell).join(',')}\n`;
  }
}

async function importVendorCatalog(rows = [], authContext) {
  const failed = [];
  const updatedProductIds = new Set();
  let updatedProducts = 0;
  let updatedCostCenters = 0;

  for (const [index, row] of rows.entries()) {
    try {
      const productId = importText(row, 'productId');
      if (!productId) throw validationError('productId is required');
      assertValidObjectId(productId, 'productId');

      if (!updatedProductIds.has(productId)) {
        const existingProduct = await productRepository.findById(productId);
        if (!existingProduct) throw notFound('Vendor product not found');
        const productPatch = mutablePatch({
          name: importText(row, 'productName'),
          externalProductId: importText(row, 'productExternalId'),
          imageUrl: importText(row, 'productImageUrl'),
          productUrl: importText(row, 'productUrl'),
          designTemplateUrl: importText(row, 'designTemplateUrl'),
          minProductionDays: importInteger(row, 'minProductionDays'),
          maxProductionDays: importInteger(row, 'maxProductionDays'),
          baseCostAmount: importInteger(row, 'productBaseCostAmount'),
          currency: importText(row, 'productCurrency')?.toUpperCase(),
          status: importStatus(row, 'productStatus'),
        }, [
          'name', 'externalProductId', 'imageUrl', 'productUrl', 'designTemplateUrl', 'minProductionDays',
          'maxProductionDays', 'baseCostAmount', 'currency', 'status',
        ]);
        assertProductionDaysRange({
          minProductionDays: productPatch.minProductionDays ?? existingProduct.minProductionDays,
          maxProductionDays: productPatch.maxProductionDays ?? existingProduct.maxProductionDays,
        });
        if (Object.keys(productPatch).length && hasPatchChanges(existingProduct, productPatch)) {
          await productRepository.update(productId, productPatch);
          updatedProducts += 1;
        }
        updatedProductIds.add(productId);
      }

      const costCenterId = importText(row, 'costCenterId');
      if (!costCenterId) continue;
      assertValidObjectId(costCenterId, 'costCenterId');
      const existingCostCenter = await costCenterRepository.findById(costCenterId);
      if (!existingCostCenter || !idEquals(existingCostCenter.vendorProductId, productId)) {
        throw notFound('Vendor cost center not found');
      }
      const domesticEconomyAmount = importInteger(row, 'domesticEconomyAmount');
      const domesticAdditionalAmount = importInteger(row, 'domesticAdditionalAmount');
      const internationalEconomyAmount = importInteger(row, 'internationalEconomyAmount');
      const internationalAdditionalAmount = importInteger(row, 'internationalAdditionalAmount');
      const priorityEconomyAmount = importInteger(row, 'priorityEconomyAmount');
      const priorityAdditionalAmount = importInteger(row, 'priorityAdditionalAmount');
      const embroideryAmount = importInteger(row, 'embroideryAmount');
      const twoSidedPrintAmount = importInteger(row, 'twoSidedPrintAmount');
      const twoPositionPrintAmount = importInteger(row, 'twoPositionPrintAmount');
      const costCenterPatch = mutablePatch({
        name: importText(row, 'costCenterName'), sku: importText(row, 'sku'), lngCode: importText(row, 'lngCode'),
        vendorSize: importText(row, 'vendorSize'), vendorColor: importText(row, 'vendorColor'),
        standardSize: importText(row, 'standardSize'), standardColor: importText(row, 'standardColor'),
        printMethod: importText(row, 'printMethod')?.toUpperCase(), weight: importNumber(row, 'weight'),
        weightUnit: importText(row, 'weightUnit')?.toUpperCase(), width: importNumber(row, 'width'),
        length: importNumber(row, 'length'), height: importNumber(row, 'height'),
        dimensionUnit: importText(row, 'dimensionUnit')?.toUpperCase(), baseCostAmount: importInteger(row, 'baseCostAmount'),
        currency: importText(row, 'currency')?.toUpperCase(), importTaxAmount: importInteger(row, 'importTaxAmount'),
        status: importStatus(row, 'costCenterStatus'),
        domesticShipping: domesticEconomyAmount === undefined && domesticAdditionalAmount === undefined ? undefined : {
          economyAmount: domesticEconomyAmount, additionalAmount: domesticAdditionalAmount,
        },
        internationalShipping: internationalEconomyAmount === undefined && internationalAdditionalAmount === undefined ? undefined : {
          economyAmount: internationalEconomyAmount, additionalAmount: internationalAdditionalAmount,
        },
        priorityShipping: priorityEconomyAmount === undefined && priorityAdditionalAmount === undefined ? undefined : {
          economyAmount: priorityEconomyAmount, additionalAmount: priorityAdditionalAmount,
        },
        additionalCosts: embroideryAmount === undefined && twoSidedPrintAmount === undefined && twoPositionPrintAmount === undefined ? undefined : {
          embroideryAmount, twoSidedPrintAmount, twoPositionPrintAmount,
        },
      }, [
        'name', 'sku', 'lngCode', 'vendorSize', 'vendorColor', 'standardSize', 'standardColor', 'printMethod',
        'weight', 'weightUnit', 'width', 'length', 'height', 'dimensionUnit', 'baseCostAmount', 'currency',
        'domesticShipping', 'internationalShipping', 'priorityShipping', 'importTaxAmount', 'additionalCosts', 'status',
      ]);
      if (Object.keys(costCenterPatch).length && hasPatchChanges(existingCostCenter, costCenterPatch)) {
        await costCenterRepository.update(costCenterId, costCenterPatch);
        updatedCostCenters += 1;
      }
    } catch (error) {
      failed.push(`Row ${index + 2}: ${error.message}`);
    }
  }
  if (updatedProducts || updatedCostCenters || failed.length) {
    await recordVendorOperation({
      action: 'VENDOR_CATALOG_IMPORTED',
      entityType: 'VENDOR_CATALOG_IMPORT',
      entity: `catalog-import:${crypto.randomUUID()}`,
      authContext,
      metadata: { total: rows.length, updatedProducts, updatedCostCenters, failedCount: failed.length },
    });
  }
  return { total: rows.length, updatedProducts, updatedCostCenters, failed };
}

async function importVendorTemplate(payload, authContext) {
  // Kept lazy to avoid loading the command entrypoint during normal vendor operations.
  const { importVendorTemplateRows } = require('../scripts/importVendorTemplate');
  return importVendorTemplateRows({ ...payload, allowUnassignedProductTypes: true, skipInvalidRows: false, authContext });
}

function parseMoneyAmount(value, key = 'amount') {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') {
    if (Number.isNaN(value) || value < 0) throw validationError(`${key} must be a non-negative number`);
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }
  let str = String(value).trim();
  if (str === '') return undefined;
  const hasCurrencySign = /[$€£]/.test(str);
  str = str.replace(/[$€£\s]/g, '');

  if (str.includes('.') && str.includes(',')) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    if (/^\d*,\d{1,2}$/.test(str)) {
      str = str.replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  }

  const num = Number(str);
  if (Number.isNaN(num) || num < 0) throw validationError(`${key} must be a non-negative number`);
  if (str.includes('.') || hasCurrencySign) {
    return Math.round(num * 100);
  }
  return Math.round(num);
}

function getRowValue(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim();
    }
    const lowerKey = k.toLowerCase();
    if (row[lowerKey] !== undefined && row[lowerKey] !== null && String(row[lowerKey]).trim() !== '') {
      return String(row[lowerKey]).trim();
    }
  }
  return undefined;
}

async function importVendorProductsUnified({ vendorId, rows = [] } = {}, authContext) {
  if (!vendorId) throw validationError('vendorId is required');
  assertValidObjectId(vendorId, 'vendorId');
  await assertVendorActive(vendorId);

  const safeRows = Array.isArray(rows) ? rows.slice(0, 1000) : [];
  if (safeRows.length === 0) {
    return {
      total: 0,
      created: 0,
      createdProducts: 0,
      updatedProducts: 0,
      createdCostCenters: 0,
      updatedCostCenters: 0,
      failed: [],
    };
  }

  const failed = [];
  let createdProducts = 0;
  let updatedProducts = 0;
  let createdCostCenters = 0;
  let updatedCostCenters = 0;

  const enrichedRows = safeRows.map((row, index) => ({
    ...row,
    __rowNumber: index + 2,
  }));

  const productGroups = new Map();
  for (const row of enrichedRows) {
    const rawCode = getRowValue(row, 'productCode', 'code');
    if (!rawCode) {
      failed.push(`Row ${row.__rowNumber}: Product code is required`);
      continue;
    }
    const pCode = normalizeCode(rawCode);
    if (!productGroups.has(pCode)) {
      productGroups.set(pCode, []);
    }
    productGroups.get(pCode).push(row);
  }

  for (const [productCode, groupRows] of productGroups) {
    let existingProduct = await productRepository.findByCode({
      vendorId,
      code: productCode,
      includeInactive: true,
    });

    if (!existingProduct) {
      const primaryRow = groupRows.find((r) => Boolean(getRowValue(r, 'productName', 'name'))) || groupRows[0];
      const name = getRowValue(primaryRow, 'productName', 'name');
      if (!name) {
        for (const r of groupRows) {
          failed.push(`Row ${r.__rowNumber}: Product name is required for new product ${productCode}`);
        }
        continue;
      }

      try {
        const minProductionDays = importInteger(primaryRow, 'minProductionDays') ?? 1;
        const maxProductionDays = importInteger(primaryRow, 'maxProductionDays') ?? 5;
        assertProductionDaysRange({ minProductionDays, maxProductionDays });

        const externalProductId = getRowValue(primaryRow, 'externalProductId', 'externalproductid') || null;
        const productTypeGroupId = getRowValue(primaryRow, 'productTypeGroupId', 'producttypegroupid');
        if (productTypeGroupId) {
          assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
          await assertProductTypeGroupActive(productTypeGroupId);
        }

        const rawProductBaseCost = getRowValue(primaryRow, 'productBaseCostAmount', 'baseCostAmount', 'basecostamount');
        const baseCostAmount = parseMoneyAmount(rawProductBaseCost, 'baseCostAmount') ?? 0;
        const currency = (getRowValue(primaryRow, 'currency') || 'USD').toUpperCase();
        const rawStatus = getRowValue(primaryRow, 'status', 'productStatus');
        const status = rawStatus ? importStatus({ status: rawStatus }, 'status') : recordStatuses.ACTIVE;

        existingProduct = await productRepository.create({
          vendorId,
          code: productCode,
          name,
          productTypeGroupId: productTypeGroupId || null,
          externalProductId,
          minProductionDays,
          maxProductionDays,
          baseCostAmount,
          currency,
          status,
        });
        createdProducts += 1;
        await recordVendorOperation({
          action: 'VENDOR_PRODUCT_CREATED',
          entityType: 'VENDOR_PRODUCT',
          entity: existingProduct,
          authContext,
          metadata: { vendorId: String(vendorId), isImport: true },
        });
      } catch (err) {
        for (const r of groupRows) {
          failed.push(`Row ${r.__rowNumber}: ${err.message}`);
        }
        continue;
      }
    } else {
      const primaryRow = groupRows[0];
      const updateName = getRowValue(primaryRow, 'productName', 'name');
      const externalProductId = getRowValue(primaryRow, 'externalProductId', 'externalproductid');
      const minProductionDays = importInteger(primaryRow, 'minProductionDays');
      const maxProductionDays = importInteger(primaryRow, 'maxProductionDays');
      const rawProductBaseCost = getRowValue(primaryRow, 'productBaseCostAmount', 'baseCostAmount', 'basecostamount');
      const baseCostAmount = parseMoneyAmount(rawProductBaseCost, 'baseCostAmount');
      const currency = getRowValue(primaryRow, 'currency')?.toUpperCase();
      const rawStatus = getRowValue(primaryRow, 'status', 'productStatus');
      const status = rawStatus ? importStatus({ status: rawStatus }, 'status') : undefined;

      const patch = mutablePatch({
        name: updateName,
        externalProductId,
        minProductionDays,
        maxProductionDays,
        baseCostAmount,
        currency,
        status,
      }, ['name', 'externalProductId', 'minProductionDays', 'maxProductionDays', 'baseCostAmount', 'currency', 'status']);

      if (patch.minProductionDays !== undefined || patch.maxProductionDays !== undefined) {
        assertProductionDaysRange({
          minProductionDays: patch.minProductionDays ?? existingProduct.minProductionDays,
          maxProductionDays: patch.maxProductionDays ?? existingProduct.maxProductionDays,
        });
      }
      if (Object.keys(patch).length && hasPatchChanges(existingProduct, patch)) {
        existingProduct = await productRepository.update(existingProduct._id, patch);
        updatedProducts += 1;
      }
    }

    const productId = existingProduct._id || existingProduct.id;
    const resolvedVendorId = existingProduct.vendorId?._id || existingProduct.vendorId || vendorId;

    for (const row of groupRows) {
      try {
        const vendorSize = getRowValue(row, 'vendorSize', 'size');
        const vendorColor = getRowValue(row, 'vendorColor', 'color');
        const standardSize = getRowValue(row, 'standardSize', 'standardsize') || vendorSize;
        const standardColor = getRowValue(row, 'standardColor', 'standardcolor') || vendorColor;

        const rawCcCode = getRowValue(row, 'costCenterCode', 'costcentercode', 'code_cc', 'ccCode');
        let costCenterCode;
        if (rawCcCode) {
          costCenterCode = normalizeCode(rawCcCode);
        } else if (vendorSize || vendorColor) {
          costCenterCode = normalizeCode(`${productCode}-${vendorSize || 'ALL'}-${vendorColor || 'ALL'}`);
        } else {
          costCenterCode = normalizeCode(`${productCode}-DEFAULT`);
        }

        const rawCcName = getRowValue(row, 'costCenterName', 'costcentername');
        let costCenterName;
        if (rawCcName) {
          costCenterName = rawCcName;
        } else if (vendorSize || vendorColor) {
          costCenterName = `${existingProduct.name} - ${[vendorSize, vendorColor].filter(Boolean).join(' / ')}`;
        } else {
          costCenterName = `${existingProduct.name} (Default)`;
        }

        const rawBaseCost = getRowValue(row, 'baseCostAmount', 'basecostamount');
        const baseCostAmount = parseMoneyAmount(rawBaseCost, 'baseCostAmount') ?? existingProduct.baseCostAmount ?? 0;
        const currency = (getRowValue(row, 'currency') || existingProduct.currency || 'USD').toUpperCase();

        const domesticEconomyAmount = parseMoneyAmount(getRowValue(row, 'domesticEconomyAmount', 'domesticeconomyamount'), 'domesticEconomyAmount');
        const domesticAdditionalAmount = parseMoneyAmount(getRowValue(row, 'domesticAdditionalAmount', 'domesticadditionalamount'), 'domesticAdditionalAmount');
        const internationalEconomyAmount = parseMoneyAmount(getRowValue(row, 'internationalEconomyAmount', 'internationaleconomyamount'), 'internationalEconomyAmount');
        const internationalAdditionalAmount = parseMoneyAmount(getRowValue(row, 'internationalAdditionalAmount', 'internationaladditionalamount'), 'internationalAdditionalAmount');
        const priorityEconomyAmount = parseMoneyAmount(getRowValue(row, 'priorityEconomyAmount', 'priorityeconomyamount'), 'priorityEconomyAmount');
        const priorityAdditionalAmount = parseMoneyAmount(getRowValue(row, 'priorityAdditionalAmount', 'priorityadditionalamount'), 'priorityAdditionalAmount');
        const importTaxAmount = parseMoneyAmount(getRowValue(row, 'importTaxAmount', 'importtaxamount'), 'importTaxAmount');
        const embroideryAmount = parseMoneyAmount(getRowValue(row, 'embroideryAmount', 'embroideryamount'), 'embroideryAmount');
        const twoSidedPrintAmount = parseMoneyAmount(getRowValue(row, 'twoSidedPrintAmount', 'twosidedprintamount'), 'twoSidedPrintAmount');
        const twoPositionPrintAmount = parseMoneyAmount(getRowValue(row, 'twoPositionPrintAmount', 'twopositionprintamount'), 'twoPositionPrintAmount');

        const sku = getRowValue(row, 'sku');
        const lngCode = getRowValue(row, 'lngCode', 'lngcode');
        const rawPrintMethod = getRowValue(row, 'printMethod', 'printmethod');
        const printMethod = rawPrintMethod ? rawPrintMethod.toUpperCase() : undefined;
        const weight = importNumber(row, 'weight');
        const weightUnit = getRowValue(row, 'weightUnit', 'weightunit')?.toUpperCase();
        const width = importNumber(row, 'width');
        const length = importNumber(row, 'length');
        const height = importNumber(row, 'height');
        const dimensionUnit = getRowValue(row, 'dimensionUnit', 'dimensionunit')?.toUpperCase();
        const rawStatus = getRowValue(row, 'costCenterStatus', 'status');
        const status = rawStatus ? importStatus({ status: rawStatus }, 'status') : recordStatuses.ACTIVE;

        const existingCc = await costCenterRepository.findByProductAndCode({
          vendorProductId: productId,
          code: costCenterCode,
        });

        if (!existingCc) {
          await costCenterRepository.create({
            vendorProductId: productId,
            vendorId: resolvedVendorId,
            code: costCenterCode,
            name: costCenterName,
            sku: sku || null,
            lngCode: lngCode || null,
            vendorSize: vendorSize || null,
            vendorColor: vendorColor || null,
            standardSize: standardSize || null,
            standardColor: standardColor || null,
            printMethod: printMethod || null,
            weight: weight ?? null,
            weightUnit: weightUnit || null,
            width: width ?? null,
            length: length ?? null,
            height: height ?? null,
            dimensionUnit: dimensionUnit || null,
            baseCostAmount,
            currency,
            domesticShipping: (domesticEconomyAmount !== undefined || domesticAdditionalAmount !== undefined) ? {
              economyAmount: domesticEconomyAmount ?? 0,
              additionalAmount: domesticAdditionalAmount ?? 0,
            } : undefined,
            internationalShipping: (internationalEconomyAmount !== undefined || internationalAdditionalAmount !== undefined) ? {
              economyAmount: internationalEconomyAmount ?? 0,
              additionalAmount: internationalAdditionalAmount ?? 0,
            } : undefined,
            priorityShipping: (priorityEconomyAmount !== undefined || priorityAdditionalAmount !== undefined) ? {
              economyAmount: priorityEconomyAmount ?? 0,
              additionalAmount: priorityAdditionalAmount ?? 0,
            } : undefined,
            importTaxAmount: importTaxAmount ?? 0,
            additionalCosts: (embroideryAmount !== undefined || twoSidedPrintAmount !== undefined || twoPositionPrintAmount !== undefined) ? {
              embroideryAmount: embroideryAmount ?? 0,
              twoSidedPrintAmount: twoSidedPrintAmount ?? 0,
              twoPositionPrintAmount: twoPositionPrintAmount ?? 0,
            } : undefined,
            status,
          });
          createdCostCenters += 1;
        } else {
          const ccPatch = mutablePatch({
            name: costCenterName,
            sku: sku || undefined,
            lngCode: lngCode || undefined,
            vendorSize: vendorSize || undefined,
            vendorColor: vendorColor || undefined,
            standardSize: standardSize || undefined,
            standardColor: standardColor || undefined,
            printMethod,
            weight,
            weightUnit,
            width,
            length,
            height,
            dimensionUnit,
            baseCostAmount,
            currency,
            importTaxAmount,
            status,
            domesticShipping: (domesticEconomyAmount !== undefined || domesticAdditionalAmount !== undefined) ? {
              economyAmount: domesticEconomyAmount ?? existingCc.domesticShipping?.economyAmount ?? 0,
              additionalAmount: domesticAdditionalAmount ?? existingCc.domesticShipping?.additionalAmount ?? 0,
            } : undefined,
            internationalShipping: (internationalEconomyAmount !== undefined || internationalAdditionalAmount !== undefined) ? {
              economyAmount: internationalEconomyAmount ?? existingCc.internationalShipping?.economyAmount ?? 0,
              additionalAmount: internationalAdditionalAmount ?? existingCc.internationalShipping?.additionalAmount ?? 0,
            } : undefined,
            priorityShipping: (priorityEconomyAmount !== undefined || priorityAdditionalAmount !== undefined) ? {
              economyAmount: priorityEconomyAmount ?? existingCc.priorityShipping?.economyAmount ?? 0,
              additionalAmount: priorityAdditionalAmount ?? existingCc.priorityShipping?.additionalAmount ?? 0,
            } : undefined,
            additionalCosts: (embroideryAmount !== undefined || twoSidedPrintAmount !== undefined || twoPositionPrintAmount !== undefined) ? {
              embroideryAmount: embroideryAmount ?? existingCc.additionalCosts?.embroideryAmount ?? 0,
              twoSidedPrintAmount: twoSidedPrintAmount ?? existingCc.additionalCosts?.twoSidedPrintAmount ?? 0,
              twoPositionPrintAmount: twoPositionPrintAmount ?? existingCc.additionalCosts?.twoPositionPrintAmount ?? 0,
            } : undefined,
          }, [
            'name', 'sku', 'lngCode', 'vendorSize', 'vendorColor', 'standardSize', 'standardColor',
            'printMethod', 'weight', 'weightUnit', 'width', 'length', 'height', 'dimensionUnit',
            'baseCostAmount', 'currency', 'domesticShipping', 'internationalShipping', 'priorityShipping',
            'importTaxAmount', 'additionalCosts', 'status',
          ]);

          if (Object.keys(ccPatch).length && hasPatchChanges(existingCc, ccPatch)) {
            await costCenterRepository.update(existingCc._id, ccPatch);
            updatedCostCenters += 1;
          }
        }
      } catch (err) {
        failed.push(`Row ${row.__rowNumber}: ${err.message}`);
      }
    }
  }

  if (createdProducts || updatedProducts || createdCostCenters || updatedCostCenters || failed.length) {
    await recordVendorOperation({
      action: 'VENDOR_PRODUCT_IMPORTED',
      entityType: 'VENDOR_PRODUCT_IMPORT',
      entity: `product-import:${crypto.randomUUID()}`,
      authContext,
      metadata: {
        vendorId: String(vendorId),
        total: safeRows.length,
        createdProducts,
        updatedProducts,
        createdCostCenters,
        updatedCostCenters,
        failedCount: failed.length,
      },
    });
  }

  return {
    total: safeRows.length,
    created: createdProducts + createdCostCenters,
    createdProducts,
    updatedProducts,
    createdCostCenters,
    updatedCostCenters,
    failed,
  };
}

async function searchActiveVendors({ q, limit = 20 } = {}) {
  const rows = await vendorRepository.listActive({ q, limit: limit + 1 });
  return {
    items: rows.slice(0, limit).map((vendor) => ({
      id: String(vendor._id || vendor.id),
      code: vendor.code,
      name: vendor.name,
    })),
    hasMore: rows.length > limit,
  };
}

async function listActiveVendorProductsByVendor(vendorId, { productTypeGroupId } = {}) {
  if (productTypeGroupId) assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  const [, rows] = await Promise.all([
    assertVendorActive(vendorId),
    productRepository.listActiveByVendor(vendorId, { productTypeGroupId }),
  ]);
  return rows.map((product) => ({
    id: String(product._id || product.id),
    code: product.code,
    name: product.name,
  }));
}

async function getVendorProductOptions(productId, { size, color } = {}) {
  const [, costCenters] = await Promise.all([
    assertActiveVendorProduct(productId),
    costCenterRepository.listOptionsByProduct(productId),
  ]);
  const rows = costCenters.map((row) => ({
    ...row,
    standardSize: row.standardSize || row.vendorSize || null,
    standardColor: row.standardColor || row.vendorColor || null,
  }));
  const hasSize = rows.some((row) => Boolean(row.standardSize));
  const hasColor = rows.some((row) => Boolean(row.standardColor));
  const selectionComplete = (!hasSize || Boolean(size)) && (!hasColor || Boolean(color));
  const matchingRows = rows.filter((row) => (
    (!size || row.standardSize === size) && (!color || row.standardColor === color)
  ));
  const unique = (values) => [...new Set(values.filter(Boolean))].sort();

  const toCandidate = (row) => ({
    id: String(row._id || row.id),
    code: row.code,
    sku: row.sku,
    size: row.standardSize || null,
    color: row.standardColor || null,
    baseCostAmount: row.baseCostAmount,
    currency: row.currency,
  });
  return {
    dimensions: { hasSize, hasColor },
    options: {
      sizes: unique(rows.filter((row) => !color || row.standardColor === color).map((row) => row.standardSize)),
      colors: unique(rows.filter((row) => !size || row.standardSize === size).map((row) => row.standardColor)),
    },
    candidates: (selectionComplete ? matchingRows : []).map(toCandidate),
    allCandidates: rows.map(toCandidate),
  };
}

async function getVendorProduct(productId) {
  assertValidObjectId(productId, 'vendorProductId');
  const product = await productRepository.findById(productId);
  if (!product) throw notFound('Vendor product not found');
  const costCenterCount = await costCenterRepository.countByProduct(product._id || product.id);
  return toVendorProductDto(product, { detail: true, costCenterCount });
}

async function createVendorProduct(payload, authContext) {
  assertProductionDaysRange(payload);
  await Promise.all([
    assertVendorActive(payload.vendorId),
    ...(payload.productTypeGroupId ? [assertProductTypeGroupActive(payload.productTypeGroupId)] : []),
  ]);

  try {
    const product = await productRepository.create({
      ...payload,
      productTypeGroupId: payload.productTypeGroupId || null,
      code: normalizeCode(payload.code),
    });
    await recordVendorOperation({
      action: 'VENDOR_PRODUCT_CREATED', entityType: 'VENDOR_PRODUCT', entity: product, authContext,
      metadata: { vendorId: String(payload.vendorId), productTypeGroupId: payload.productTypeGroupId ? String(payload.productTypeGroupId) : null },
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
    'unitSurchargeAmount',
    'currency',
    'status',
    'metadata',
  ]);

  if (updatePatch.productTypeGroupId) await assertProductTypeGroupActive(updatePatch.productTypeGroupId);
  assertProductionDaysRange({
    minProductionDays: Object.prototype.hasOwnProperty.call(updatePatch, 'minProductionDays')
      ? updatePatch.minProductionDays
      : existing.minProductionDays,
    maxProductionDays: Object.prototype.hasOwnProperty.call(updatePatch, 'maxProductionDays')
      ? updatePatch.maxProductionDays
      : existing.maxProductionDays,
  });

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

function cloneMetadata(metadata = {}) {
  const result = { ...metadata };
  delete result.legacyId;
  delete result.externalProductId;
  return result;
}

async function cloneVendorProduct(productId, payload, authContext) {
  const source = await getVendorProductById(productId);
  if (!source) throw notFound('Vendor product not found');
  const targetVendor = await assertVendorActive(payload.vendorId);
  const targetVendorId = targetVendor._id || targetVendor.id;
  const sourceVendorId = source.vendorId?._id || source.vendorId;
  const vendorChanged = String(sourceVendorId) !== String(targetVendorId);
  const requestedCode = normalizeCode(payload.code || `${source.code}-COPY`);
  let code = requestedCode;
  let suffix = 1;
  while (await productRepository.findByCode({ vendorId: targetVendorId, code, includeInactive: true })) {
    code = `${requestedCode}-${suffix}`;
    suffix += 1;
  }

  const productPayload = {
    vendorId: targetVendorId,
    productTypeGroupId: source.productTypeGroupId?._id || source.productTypeGroupId || null,
    code,
    name: payload.name || `${source.name} Copy`,
    externalProductId: null,
    imageUrl: source.imageUrl || null,
    productUrl: source.productUrl || null,
    designTemplateUrl: source.designTemplateUrl || null,
    minProductionDays: source.minProductionDays ?? null,
    maxProductionDays: source.maxProductionDays ?? null,
    baseCostAmount: source.baseCostAmount,
    unitSurchargeAmount: source.unitSurchargeAmount ?? null,
    currency: source.currency,
    status: source.status,
    metadata: cloneMetadata(source.metadata),
  };
  let createdProduct;
  try {
    createdProduct = await productRepository.create(productPayload);
    const costCenters = await costCenterRepository.listByProduct(productId);
    await costCenterRepository.createMany(costCenters.map(({ _id, id, vendorProductId, vendorId, createdAt, updatedAt, __v, metadata, ...costCenter }) => ({
      ...costCenter,
      vendorProductId: createdProduct._id || createdProduct.id,
      vendorId: targetVendorId,
      ...(vendorChanged ? { status: recordStatuses.INACTIVE } : {}),
      metadata: cloneMetadata(metadata),
    })));
  } catch (error) {
    if (createdProduct?._id || createdProduct?.id) {
      await costCenterRepository.deleteByProduct(createdProduct._id || createdProduct.id).catch(() => {});
      await productRepository.deleteById(createdProduct._id || createdProduct.id).catch(() => {});
    }
    await mapDuplicate(error, 'Vendor product or cost center code already exists');
    throw error;
  }
  await recordVendorOperation({
    action: 'VENDOR_PRODUCT_CLONED', entityType: 'VENDOR_PRODUCT', entity: createdProduct, authContext,
    metadata: { sourceProductId: String(productId), vendorId: String(targetVendorId) },
  });
  const costCenterCount = await costCenterRepository.countByProduct(createdProduct._id || createdProduct.id);
  return toVendorProductDto(createdProduct, { detail: true, costCenterCount });
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

function toMigrationReviewDto(review) {
  return {
    id: String(review._id),
    vendorCode: review.vendorCode || null,
    vendorName: review.vendorName || null,
    code: review.code,
    name: review.name,
    externalProductId: review.externalProductId || null,
    imageUrl: review.imageUrl || null,
    variantCount: review.variantCount || 0,
  };
}

async function listVendorMigrationReviews(query = {}) {
  const [result, orphaned] = await Promise.all([
    productRepository.listUnassignedForMigration(query),
    migrationReviewRepository.countPending(),
  ]);
  return {
    ...toPaginatedResponse(result, toMigrationReviewDto),
    summary: { pending: result.total, ready: 0, orphaned },
  };
}

async function assignVendorMigrationProductTypeGroup(productIds, productTypeGroupId, authContext) {
  await assertProductTypeGroupActive(productTypeGroupId);
  const updated = await productRepository.assignProductTypeGroupByIds(productIds, productTypeGroupId);
  await recordVendorOperation({
    action: 'VENDOR_MIGRATION_PRODUCT_TYPE_GROUP_ASSIGNED',
    entityType: 'VENDOR_MIGRATION_REVIEW',
    entity: `product-type-group:${productTypeGroupId}:${productIds.join(',')}`,
    authContext,
    metadata: { productTypeGroupId, productIds, updated },
  });
  return { updated };
}

async function stageVendorMigrationReviews(rows = []) {
  for (const row of rows) await migrationReviewRepository.upsert(row);
}

async function findVendorProductByLegacyId(legacyId) {
  return productRepository.findByLegacyId(legacyId);
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

async function syncVendorProductFromIntegration(productId, authContext) {
  const product = await assertActiveVendorProduct(productId);
  const provider = String(product.vendorId?.providerKey || product.vendorId?.code || '').toUpperCase();
  const adapter = integrationAdapterRegistry.getAdapter(provider);
  if (!adapter?.fetchVariations || !product.externalProductId) {
    throw validationError(`Catalog sync is not supported for ${provider || 'vendor'}`);
  }
  const credential = await getVendorIntegrationCredential(String(product.vendorId._id || product.vendorId), provider);
  if (!credential) throw validationError('Vendor credentials are not configured');
  const variations = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await adapter.fetchVariations({ credential, productId: product.externalProductId, productName: product.name, page, limit: 200 });
    variations.push(...(data.items || []));
    if (page >= Number(data.pagination?.pages || page) || !(data.items || []).length) break;
  }
  const bySku = new Map(variations.map((row) => [String(row.sku || '').trim().toUpperCase(), row]));
  const centers = await costCenterRepository.listByProduct(productId);
  const result = { total: centers.length, matched: 0, updated: 0, missing: [], items: [] };
  for (const center of centers) {
    const row = bySku.get(String(center.sku || '').trim().toUpperCase());
    if (!row) { result.missing.push(center.sku || center.code); continue; }
    const vendorPrice = Number(row.price);
    const patch = {
      vendorSize: row.size || center.vendorSize,
      vendorColor: row.color || center.vendorColor,
      baseCostAmount: Number.isFinite(vendorPrice) ? Math.round(vendorPrice * 100) + 100 : center.baseCostAmount,
      currency: row.currency || center.currency || 'USD',
      status: row.is_available === false ? 'INACTIVE' : 'ACTIVE',
      metadata: {
        ...(center.metadata || {}),
        vendorSync: { source: provider, sourceSku: row.sku, vendorPrice, isAvailable: row.is_available !== false, syncedAt: new Date() },
      },
    };
    const updated = await costCenterRepository.update(center._id, patch);
    result.matched += 1;
    result.updated += updated ? 1 : 0;
    result.items.push({ id: String(center._id), sku: row.sku, vendorPrice, systemBaseCostAmount: patch.baseCostAmount, status: patch.status });
  }
  await recordVendorOperation({ action: 'VENDOR_CATALOG_SYNCED', entityType: 'VENDOR_PRODUCT', entity: product, authContext, metadata: { ...result, missing: result.missing.slice(0, 100) } });
  return result;
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
    const directCostFields = Object.keys(pickCostRateFields(patch));
    if (directCostFields.length) throw validationError('COST_RATE_APPEND_REQUIRED');

    const updatePatch = mutablePatch(patch, [
      'name',
      'sku',
      'lngCode',
      'vendorSize',
      'vendorColor',
      'standardSize',
      'standardColor',
      'printMethod',
      'attributes',
      'weight',
      'weightUnit',
      'width',
      'length',
      'height',
      'dimensionUnit',
      'status',
      'metadata',
    ]);
    if (patch.costRate) {
      const costRateHistory = appendCostRate(existing, patch.costRate);
      const latestCostRate = costRateHistory.at(-1);
      Object.assign(updatePatch, pickCostRateFields(latestCostRate), { costRateHistory });
    }
    const costCenter = patch.costRate && Number.isInteger(existing.__v)
      ? await costCenterRepository.updateIfVersion(costCenterId, existing.__v, updatePatch)
      : await costCenterRepository.update(costCenterId, updatePatch);
    if (!costCenter && patch.costRate) throw conflict('Vendor cost center changed. Reload before adding a cost rate');
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

async function cloneVendorCostCenter(productId, costCenterId, authContext) {
  const product = await assertActiveVendorProduct(productId);
  assertValidObjectId(costCenterId, 'vendorCostCenterId');
  const source = await costCenterRepository.findById(costCenterId);
  if (!source || String(source.vendorProductId) !== String(productId)) {
    throw notFound('Vendor cost center not found');
  }

  const requestedCode = `${normalizeCode(source.code)}-COPY`;
  let code = requestedCode;
  let suffix = 1;
  while (await costCenterRepository.findByProductAndCode({ vendorProductId: productId, code })) {
    code = `${requestedCode}-${suffix}`;
    suffix += 1;
  }
  const {
    _id, id, vendorProductId, vendorId, createdAt, updatedAt, __v, metadata, ...fields
  } = source;
  const costCenter = await costCenterRepository.create({
    ...fields,
    vendorProductId: productId,
    vendorId: product.vendorId._id || product.vendorId,
    code,
    name: `${source.name} Copy`,
    metadata: cloneMetadata(metadata),
  });
  await recordVendorOperation({
    action: 'VENDOR_COST_CENTER_CLONED', entityType: 'VENDOR_COST_CENTER', entity: costCenter, authContext,
    metadata: { sourceCostCenterId: String(costCenterId), vendorProductId: String(productId) },
  });
  return toVendorCostCenterDto(costCenter, { detail: true });
}

async function listActiveVendorCostCenters(productId) {
  const product = await assertActiveVendorProduct(productId);
  const vendorId = product.vendorId?._id || product.vendorId;
  const rows = await costCenterRepository.listActiveByProduct(productId);
  return rows.filter((row) => idEquals(row.vendorId, vendorId));
}

async function listActiveVendorCostCentersByProductIds(productIds = []) {
  return listActiveCostCentersForProducts(
    productIds,
    (activeProductIds) => costCenterRepository.listActiveByProducts(activeProductIds),
  );
}

async function listActiveCostCentersForProducts(productIds, listRows) {
  const uniqueProductIds = [...new Set((productIds || []).filter(Boolean).map(String))];
  uniqueProductIds.forEach((productId) => assertValidObjectId(productId, 'vendorProductId'));
  if (!uniqueProductIds.length) return [];

  const products = await productRepository.listActiveByIds(uniqueProductIds);
  const activeProductVendorById = new Map(products
    .filter((product) => product.vendorId && product.vendorId.status === recordStatuses.ACTIVE)
    .map((product) => [toId(product), toId(product.vendorId)]));
  const rows = await listRows([...activeProductVendorById.keys()]);
  return rows.filter((row) => idEquals(row.vendorId, activeProductVendorById.get(toId(row.vendorProductId))));
}

async function listActiveVendorCostCenterMatchProbesByProductIds(productIds = []) {
  return listActiveCostCentersForProducts(
    productIds,
    (activeProductIds) => costCenterRepository.listActiveMatchProbesByProducts(activeProductIds),
  );
}

async function listActiveVendorCostCentersByIds(costCenterIds = []) {
  const uniqueCostCenterIds = [...new Set((costCenterIds || []).filter(Boolean).map(String))];
  uniqueCostCenterIds.forEach((costCenterId) => assertValidObjectId(costCenterId, 'vendorCostCenterId'));
  return costCenterRepository.listActiveByIds(uniqueCostCenterIds);
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

async function findVendorCostCenterByLegacyId(legacyId) {
  return costCenterRepository.findByLegacyId(legacyId);
}

module.exports = {
  selectCostRate,
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  getVendorIntegrationConfig,
  getVendorIntegrationAssignment,
  testVendorIntegrationConnection,
  updateVendorIntegrationConfig,
  deleteVendorIntegrationConfig,
  getVendorIntegrationCredential,
  getLenfulCatalog,
  getMerchizeCatalog,
  importMerchizeCatalogProducts,
  getLenfulTracking,
  getLenfulOrder,
  getVendorProductionLines,
  refreshVendorIntegrationCredential,
  refreshVendorIntegrationCredentialForVendor,
  getVendorById,
  findVendorByCode,
  findVendorByLegacyId,
  listVendorProducts,
  exportVendorCatalog,
  importVendorCatalog,
  importVendorTemplate,
  importVendorProductsUnified,
  parseMoneyAmount,
  listVendorMigrationReviews,
  assignVendorMigrationProductTypeGroup,
  stageVendorMigrationReviews,
  searchActiveVendors,
  listActiveVendorProductsByVendor,
  getVendorProductOptions,
  getVendorProduct,
  createVendorProduct,
  updateVendorProduct,
  cloneVendorProduct,
  getVendorProductById,
  findVendorProductByCode,
  findVendorProductByLegacyId,
  listActiveVendorProductsByProductTypeGroup,
  listVendorCostCenters,
  syncVendorProductFromIntegration,
  createVendorCostCenter,
  updateVendorCostCenter,
  cloneVendorCostCenter,
  listActiveVendorCostCenters,
  listActiveVendorCostCentersByProductIds,
  listActiveVendorCostCenterMatchProbesByProductIds,
  listActiveVendorCostCentersByIds,
  searchVendorCostCenters,
  findVendorCostCenterByCode,
  findVendorCostCenterByLegacyId,
  assertVendorActive,
  assertProductTypeGroupActive,
};
