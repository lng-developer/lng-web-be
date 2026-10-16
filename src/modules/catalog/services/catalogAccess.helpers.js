const { normalizePagination } = require('../../../shared/utils/pagination');
const authPublic = require('../../auth/public');
const { forbidden } = require('./catalogError.helpers');

const SHOP_SCOPE_TYPE = 'shop';
const CATALOG_READ = 'CATALOG:READ';
const CATALOG_WRITE = 'CATALOG:WRITE';

function hasGlobalPermission(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission) || (
    permission === CATALOG_READ
    && permissions.includes(CATALOG_WRITE)
  );
}

function hasScopedPermission(scope = {}, permission) {
  const permissions = scope.permissions || [];
  return permissions.includes(permission) || (
    permission === CATALOG_READ
    && permissions.includes(CATALOG_WRITE)
  );
}

function getScopedShopIds(authContext = {}, permission) {
  if (authPublic.personalSellerAccountId?.(authContext)) return [];
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && hasScopedPermission(scope, permission)
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
  if (authContext.system === true) return;
  if (hasGlobalPermission(authContext, permission)) return;

  const scope = { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId };
  if (
    !authPublic.canAccessScope(authContext, permission, scope)
    && !(permission === CATALOG_READ && authPublic.canAccessScope(authContext, CATALOG_WRITE, scope))
  ) {
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
