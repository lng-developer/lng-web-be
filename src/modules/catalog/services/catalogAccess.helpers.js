const { normalizePagination } = require('../../../shared/utils/pagination');
const authPublic = require('../../auth/public');
const { forbidden } = require('./catalogError.helpers');

const SHOP_SCOPE_TYPE = 'shop';
const CATALOG_READ = 'CATALOG:READ';
const CATALOG_WRITE = 'CATALOG:WRITE';

function hasGlobalPermission(authContext = {}, permission) {
  return (authContext.permissions || []).includes(permission);
}

function getScopedShopIds(authContext = {}, permission) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(permission)
    ))
    .map((scope) => String(scope.scopeId)))];
}

function emptyPaginatedResult(query = {}) {
  const { page, limit } = normalizePagination(query);
  return {
    items: [],
    pagination: { total: 0, page, limit },
  };
}

function assertCanAccessShop(shopId, permission, authContext = {}) {
  if (hasGlobalPermission(authContext, permission)) return;

  if (!authPublic.canAccessScope(authContext, permission, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

module.exports = {
  CATALOG_READ,
  CATALOG_WRITE,
  assertCanAccessShop,
  emptyPaginatedResult,
  getScopedShopIds,
  hasGlobalPermission,
};
