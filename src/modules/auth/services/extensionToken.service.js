const config = require('../../../config');
const { generateRandomToken, hashString } = require('../../../shared/utils/crypto');
const shopPort = require('../../shop/public');
const repository = require('../repositories/extensionToken.repository');
const { canAccessScope } = require('../middlewares/authorization');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');

const DEFAULT_EXTENSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function assertShopAccess(auth, shopId) {
  if (!canAccessScope(auth, 'ORDERS:WRITE', { scopeType: 'shop', scopeId: String(shopId) })) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

function toDto(token) {
  return {
    id: String(token._id),
    name: token.name,
    shopId: String(token.shopId),
    environment: token.environment,
    tokenHint: token.tokenHint,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt || null,
    expiresAt: token.expiresAt || null,
    revokedAt: token.revokedAt || null,
  };
}

function matchesRuntimeEnvironment(environment) {
  return environment === config.env || (config.env === 'development' && environment === 'local');
}

async function create({ name, shopId, environment, expiresAt = null, createdByAccountId }) {
  await shopPort.assertShopIsActive(shopId);
  const token = `lng_ext_${generateRandomToken(32)}`;
  const tokenExpiresAt = expiresAt || new Date(Date.now() + DEFAULT_EXTENSION_TOKEN_TTL_MS);
  const record = await repository.create({
    name,
    shopId,
    environment,
    expiresAt: tokenExpiresAt,
    createdByAccountId,
    tokenHash: hashString(token),
    tokenHint: token.slice(-4),
  });

  return { token, extensionToken: toDto(record) };
}

async function authenticate(token) {
  if (!String(token).startsWith('lng_ext_')) return null;

  const record = await repository.findActiveByHash(hashString(token));
  if (
    !record ||
    !matchesRuntimeEnvironment(record.environment) ||
    (record.expiresAt && new Date(record.expiresAt) <= new Date())
  ) {
    return null;
  }

  repository.markUsed(record._id).catch(() => undefined);

  return {
    accountId: null,
    email: null,
    tokenType: 'EXTENSION',
    extensionTokenId: String(record._id),
    mustChangePassword: false,
    profileSetupRequired: false,
    roles: [],
    permissions: [],
    scopes: [{
      assignmentId: String(record._id),
      scopeType: 'shop',
      scopeId: String(record.shopId),
      roles: [],
      permissions: ['ORDERS:WRITE', 'FINANCE:WRITE'],
    }],
  };
}

async function list(filters) {
  return (await repository.list(filters)).map(toDto);
}

async function getMetadataByIds(ids) {
  return (await repository.findByIds([...new Set(ids.map(String))])).map(toDto);
}

async function revoke(id, auth) {
  const existing = await repository.findById(id);
  if (!existing) return null;
  assertShopAccess(auth, existing.shopId);
  const record = await repository.revoke(id);
  return record ? toDto(record) : null;
}

async function getIdentity(auth) {
  const scopes = (auth.scopes || []).filter(scope => scope.scopeType === 'shop');
  if (auth.tokenType !== 'EXTENSION' || scopes.length !== 1 || !scopes[0].scopeId) {
    throw new AppError('Extension shop scope required', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
  const shop = await shopPort.assertShopIsActive(scopes[0].scopeId);
  return require('../dtos/auth.dto').toExtensionIdentityDto(shop);
}

module.exports = { create, authenticate, list, getMetadataByIds, revoke, getIdentity };
