const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { financePermissions } = require('../constants/finance.constants');
const authPublic = require('../../auth/public');

function hasGlobal(auth = {}, permission) {
  if (auth.system || auth.worker || auth.import) return true;
  const permissions = auth.permissions || [];
  return permissions.includes(permission)
    || (permission === financePermissions.READ && permissions.includes(financePermissions.WRITE));
}

function scopeHas(scope, permission) {
  const permissions = scope.permissions || [];
  return permissions.includes(permission)
    || (permission === financePermissions.READ && permissions.includes(financePermissions.WRITE));
}

function accessConditions(auth = {}, permission = financePermissions.READ) {
  const sellerAccountId = authPublic.personalSellerAccountId?.(auth);
  if (sellerAccountId) {
    const allowed = (auth.permissions || []).includes(permission) || (auth.scopes || []).some(scope => scopeHas(scope, permission));
    return allowed ? [{ sellerAccountId }] : [];
  }
  if (hasGlobal(auth, permission)) return null;
  const conditions = (auth.scopes || []).filter((scope) => scopeHas(scope, permission)).flatMap((scope) => {
    if (scope.scopeType === 'shop' && scope.scopeId) return [{ shopId: String(scope.scopeId) }];
    if (scope.scopeType === 'department' && scope.scopeId) return [{ departmentId: String(scope.scopeId) }];
    if (scope.scopeType === 'team' && scope.scopeId) return [{ teamId: String(scope.scopeId) }];
    if (scope.scopeType === 'own' && auth.accountId) return [{ sellerAccountId: String(auth.accountId) }];
    return [];
  });
  return conditions.filter((condition, index, all) => (
    index === all.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(condition))
  ));
}

function scopedQuery(query = {}, auth, permission = financePermissions.READ) {
  const conditions = accessConditions(auth, permission);
  return conditions === null ? query : { ...query, accessOr: conditions };
}

function settlementScopedQuery(query = {}, auth, permission = financePermissions.READ) {
  if (authPublic.personalSellerAccountId?.(auth)) return { ...query, shopIds: [] };
  if (hasGlobal(auth, permission)) return query;
  const shopIds = (auth.scopes || [])
    .filter((scope) => scope.scopeType === 'shop' && scope.scopeId && scopeHas(scope, permission))
    .map((scope) => String(scope.scopeId));
  return { ...query, shopIds: [...new Set(shopIds)] };
}

function accessibleShopIds(auth = {}, permission = financePermissions.READ) {
  if (authPublic.personalSellerAccountId?.(auth)) return [];
  if (hasGlobal(auth, permission)) return null;
  return (auth.scopes || [])
    .filter((scope) => scope.scopeType === 'shop' && scopeHas(scope, permission) && scope.scopeId)
    .map((scope) => String(scope.scopeId));
}

function canAccessSnapshot(snapshot, auth, permission = financePermissions.READ) {
  const conditions = accessConditions(auth, permission);
  if (conditions === null) return true;
  return conditions.some((condition) => Object.entries(condition).every(
    ([key, value]) => snapshot[key] && String(snapshot[key]) === value,
  ));
}

function assertSnapshotAccess(snapshot, auth, permission) {
  if (!canAccessSnapshot(snapshot, auth, permission)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

module.exports = { accessConditions, accessibleShopIds, assertSnapshotAccess, hasGlobal, scopedQuery, settlementScopedQuery };
