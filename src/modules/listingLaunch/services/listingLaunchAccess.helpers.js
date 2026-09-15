const authPublic = require('../../auth/public');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const repository = require('../repositories/listingLaunch.repository');

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

async function findAccessibleLaunch(id, permission, auth, session = null) {
  assertValidObjectId(id);
  const launch = await repository.findById(id, session);
  if (!launch) throw new AppError('Listing launch not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
  assertCanAccessShop(launch.shopId, permission, auth);
  return launch;
}

module.exports = { CATALOG_READ, CATALOG_WRITE, hasGlobalPermission, assertCanAccessShop, getScopedShopIds, findAccessibleLaunch };
