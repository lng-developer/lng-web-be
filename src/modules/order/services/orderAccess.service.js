const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');

const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';
const OWN_SCOPE_TYPE = 'own';

function hasGlobal(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission)
    || (permission === ORDER_READ_PERMISSION && permissions.includes(ORDER_WRITE_PERMISSION));
}

function canReadShop(shopId, authContext = {}) {
  return hasGlobal(authContext, ORDER_READ_PERMISSION)
    || authPublic.canAccessScope(authContext, ORDER_READ_PERMISSION, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })
    || authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId });
}

function canWriteShop(shopId, authContext = {}) {
  return hasGlobal(authContext, ORDER_WRITE_PERMISSION)
    || authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId });
}

function canReadOrder(order = {}, authContext = {}) {
  if (canReadShop(order.shopId, authContext)) return true;
  return hasOwnOrderPermission(authContext, ORDER_READ_PERMISSION)
    && Boolean(authContext.accountId)
    && (order.assignedStaffIds || []).some((id) => String(id) === String(authContext.accountId));
}

function canWriteOrder(order = {}, authContext = {}) {
  if (canWriteShop(order.shopId, authContext)) return true;
  return hasOwnOrderPermission(authContext, ORDER_WRITE_PERMISSION)
    && Boolean(authContext.accountId)
    && (order.assignedStaffIds || []).some((id) => String(id) === String(authContext.accountId));
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function assertCanReadShop(shopId, authContext = {}) {
  if (!canReadShop(shopId, authContext)) throw forbidden();
}

function assertCanReadOrder(order, authContext = {}) {
  if (!canReadOrder(order, authContext)) throw forbidden();
}

function assertCanWriteOrder(order, authContext = {}) {
  if (!canWriteOrder(order, authContext)) throw forbidden();
}

function assertCanWriteShop(shopId, authContext = {}) {
  if (!canWriteShop(shopId, authContext)) throw forbidden();
}

function getReadableShopIds(authContext = {}) {
  if (hasGlobal(authContext, ORDER_READ_PERMISSION)) return null;
  return [...new Set((authContext.scopes || [])
    .filter((scope) => scope.scopeType === SHOP_SCOPE_TYPE && scope.scopeId
      && ((scope.permissions || []).includes(ORDER_READ_PERMISSION)
        || (scope.permissions || []).includes(ORDER_WRITE_PERMISSION)))
    .map((scope) => String(scope.scopeId)))];
}

function hasOwnOrderPermission(authContext = {}, permission) {
  return (authContext.scopes || []).some((scope) => (
    scope.scopeType === OWN_SCOPE_TYPE
    && ((scope.permissions || []).includes(permission)
      || (permission === ORDER_READ_PERMISSION && (scope.permissions || []).includes(ORDER_WRITE_PERMISSION)))
  ));
}

function getOrderReadConstraint(authContext = {}) {
  const shopIds = getReadableShopIds(authContext);
  if (shopIds === null || shopIds.length) return { shopIds, assignedStaffIds: null };
  return {
    shopIds: [],
    assignedStaffIds: hasOwnOrderPermission(authContext, ORDER_READ_PERMISSION) && authContext.accountId
      ? [String(authContext.accountId)]
      : [],
  };
}

module.exports = {
  canReadOrder,
  canWriteOrder,
  canReadShop,
  canWriteShop,
  assertCanReadOrder,
  assertCanWriteOrder,
  assertCanReadShop,
  assertCanWriteShop,
  getReadableShopIds,
  getOrderReadConstraint,
};
