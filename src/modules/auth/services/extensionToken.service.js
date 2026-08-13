const config = require('../../../config');
const { generateRandomToken, hashString } = require('../../../shared/utils/crypto');
const shopPort = require('../../shop/public');
const repository = require('../repositories/extensionToken.repository');

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

async function create({ name, shopId, environment, expiresAt = null, createdByAccountId }) {
  await shopPort.assertShopIsActive(shopId);
  const token = `lng_ext_${generateRandomToken(32)}`;
  const record = await repository.create({
    name,
    shopId,
    environment,
    expiresAt,
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
    record.environment !== config.env ||
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

async function revoke(id) {
  const record = await repository.revoke(id);
  return record ? toDto(record) : null;
}

module.exports = { create, authenticate, list, revoke };
