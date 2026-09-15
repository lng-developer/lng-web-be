const authPublic = require('../../auth/public');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');

const CATALOG_READ = 'CATALOG:READ';
const CATALOG_WRITE = 'CATALOG:WRITE';

function hasGlobalPermission(auth = {}, permission) {
  return authPublic.isSuperAdmin(auth)
    || (auth.permissions || []).includes(permission)
    || (permission === CATALOG_READ && (auth.permissions || []).includes(CATALOG_WRITE));
}

function canAccessShop(shopId, permission, auth = {}) {
  const scope = { scopeType: 'shop', scopeId: String(shopId) };
  return authPublic.canAccessScope(auth, permission, scope)
    || (permission === CATALOG_READ && authPublic.canAccessScope(auth, CATALOG_WRITE, scope));
}

function assertCanAccessShop(shopId, permission, auth) {
  if (!canAccessShop(shopId, permission, auth)) {
    throw new AppError('Forbidden', 403, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

function getScopedShopIds(auth = {}, permission) {
  return [...new Set((auth.scopes || [])
    .filter((scope) => scope.scopeType === 'shop' && scope.scopeId && canAccessShop(scope.scopeId, permission, auth))
    .map((scope) => String(scope.scopeId)))];
}

module.exports = { CATALOG_READ, CATALOG_WRITE, hasGlobalPermission, assertCanAccessShop, getScopedShopIds };
