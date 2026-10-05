const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');

const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';
const TEAM_SCOPE_TYPE = 'team';
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

function scopeIncludesPermission(scope = {}, permission) {
  const permissions = scope.permissions || [];
  return permissions.includes(permission)
    || (permission === ORDER_READ_PERMISSION && permissions.includes(ORDER_WRITE_PERMISSION));
}

function getTeamScopeIds(authContext = {}, permission) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === TEAM_SCOPE_TYPE
      && scope.scopeId
      && scopeIncludesPermission(scope, permission)
    ))
    .map((scope) => String(scope.scopeId)))];
}

async function getTeamAssignedStaffIds(authContext = {}, permission) {
  if (!authContext.accountId) return [];

  const teamScopeIds = getTeamScopeIds(authContext, permission);
  if (!teamScopeIds.length) return [];

  const accountId = String(authContext.accountId);
  const assignedStaffIds = new Set();

  for (const teamId of teamScopeIds) {
    const members = await organizationPublic.listTeamMemberAccess(teamId);
    const actorMembership = members.find((member) => String(member.accountId) === accountId);

    if (!actorMembership) continue;

    if (String(actorMembership.memberType || '').toUpperCase() === 'LEADER') {
      members.forEach((member) => assignedStaffIds.add(String(member.accountId)));
    } else {
      assignedStaffIds.add(accountId);
    }
  }

  return [...assignedStaffIds];
}

async function canAccessAssignedOrder(order = {}, authContext = {}, permission) {
  const assignedStaffIds = await getTeamAssignedStaffIds(authContext, permission);
  if (assignedStaffIds.length) {
    return (order.assignedStaffIds || []).some((id) => assignedStaffIds.includes(String(id)));
  }

  return hasOwnOrderPermission(authContext, permission)
    && Boolean(authContext.accountId)
    && (order.assignedStaffIds || []).some((id) => String(id) === String(authContext.accountId));
}

async function canReadOrder(order = {}, authContext = {}) {
  if (canReadShop(order.shopId, authContext)) return true;
  return canAccessAssignedOrder(order, authContext, ORDER_READ_PERMISSION);
}

async function canWriteOrder(order = {}, authContext = {}) {
  if (canWriteShop(order.shopId, authContext)) return true;
  return canAccessAssignedOrder(order, authContext, ORDER_WRITE_PERMISSION);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function assertCanReadShop(shopId, authContext = {}) {
  if (!canReadShop(shopId, authContext)) throw forbidden();
}

async function assertCanReadOrder(order, authContext = {}) {
  if (!(await canReadOrder(order, authContext))) throw forbidden();
}

async function assertCanWriteOrder(order, authContext = {}) {
  if (!(await canWriteOrder(order, authContext))) throw forbidden();
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

async function getOrderReadConstraint(authContext = {}) {
  const shopIds = getReadableShopIds(authContext);
  if (shopIds === null || shopIds.length) return { shopIds, assignedStaffIds: null };

  const teamAssignedStaffIds = await getTeamAssignedStaffIds(authContext, ORDER_READ_PERMISSION);
  if (teamAssignedStaffIds.length) {
    return { shopIds: [], assignedStaffIds: teamAssignedStaffIds };
  }

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
