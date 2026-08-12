const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const roleRepository = require('../repositories/role.repository');
const permissionRepository = require('../repositories/permission.repository');
const accessAssignmentRepository = require('../repositories/accessAssignment.repository');
const scopeRegistryRepository = require('../repositories/scopeRegistry.repository');
const scopedRolePermissionRepository = require('../repositories/scopedRolePermission.repository');
const authManager = require('./authManager.service');
const {
  accessAssignmentStatuses,
  accessScopeTypes,
} = require('../constants/auth.constants');

const SCOPES_WITH_REQUIRED_ID = new Set([
  accessScopeTypes.DEPARTMENT,
  accessScopeTypes.TEAM,
  accessScopeTypes.SHOP,
  accessScopeTypes.VENDOR,
]);
const REGISTRY_SCOPE_TYPES = SCOPES_WITH_REQUIRED_ID;
const SCOPES_REQUIRING_NULL_ID = new Set([
  accessScopeTypes.GLOBAL,
  accessScopeTypes.OWN,
]);

async function ensureRolesExist(roleIds, { session, touch = false } = {}) {
  roleIds.forEach((roleId) => assertValidObjectId(roleId, 'roleId'));
  const roles = touch
    ? (await Promise.all(roleIds.map((roleId) => roleRepository.touchById(roleId, { session })))).filter(Boolean)
    : await roleRepository.findByIds(roleIds, { session });

  if (roles.length !== roleIds.length) {
    throw new AppError('One or more roles were not found', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  return roles;
}

async function ensurePermissionsExist(permissionIds, { session, touch = false } = {}) {
  permissionIds.forEach((permissionId) => assertValidObjectId(permissionId, 'permissionId'));
  const permissions = touch ? null : await permissionRepository.findByIds(permissionIds, { session });
  const foundCount = touch
    ? await permissionRepository.touchByIds(permissionIds, { session })
    : permissions.length;

  if (foundCount !== permissionIds.length) {
    throw new AppError('One or more permissions were not found', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  return permissions;
}

async function invalidateAccounts(accounts) {
  const accountIds = [...new Set(accounts.map((account) => String(account._id || account.accountId)))];
  await Promise.all(accountIds.map((accountId) => authManager.invalidatePermissionCache(accountId)));
}

async function findAccountsAffectedByPermission(permissionId) {
  const [directAccounts, roles, scopedRoleRules] = await Promise.all([
    accessAssignmentRepository.findAccountIdsByCustomPermission(permissionId),
    roleRepository.findRoleIdsByPermission(permissionId),
    scopedRolePermissionRepository.findRoleIdsByPermission(permissionId),
  ]);
  const roleIds = [
    ...roles.map((role) => role._id),
    ...scopedRoleRules.map((rule) => rule.roleId),
  ];
  const roleAccounts = roleIds.length > 0
    ? await accessAssignmentRepository.findAccountIdsByRoles(roleIds)
    : [];

  return [...directAccounts, ...roleAccounts];
}

function normalizeScopeInput(scopeType, scopeId) {
  if (!Object.values(accessScopeTypes).includes(scopeType)) {
    throw new AppError('scopeType is invalid', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  const normalizedScopeId = scopeId === '' || scopeId === undefined ? null : scopeId;

  if (SCOPES_WITH_REQUIRED_ID.has(scopeType)) {
    assertValidObjectId(normalizedScopeId, 'scopeId');
    return { scopeType, scopeId: normalizedScopeId };
  }

  if (SCOPES_REQUIRING_NULL_ID.has(scopeType) && normalizedScopeId !== null) {
    throw new AppError('scopeId must be null for this scopeType', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  return {
    scopeType,
    scopeId: null,
  };
}

function assertValidRegistryScopeType(scopeType) {
  if (!REGISTRY_SCOPE_TYPES.has(scopeType)) {
    throw new AppError('scopeType is invalid for scope registry', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

async function ensureScopeRegistered(scopeType, scopeId, { session, touch = false } = {}) {
  if (!SCOPES_WITH_REQUIRED_ID.has(scopeType)) {
    return;
  }

  const registryEntry = touch
    ? await scopeRegistryRepository.touchActiveByScope(scopeType, scopeId, { session })
    : await scopeRegistryRepository.findActiveByScope(scopeType, scopeId, { session });

  if (!registryEntry) {
    throw new AppError('Scope is not registered or inactive', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

async function ensureRoleByCode(code, { session, touch = false } = {}) {
  const found = await roleRepository.findByCode(code, { session });
  const role = found && touch ? await roleRepository.touchById(found._id, { session }) : found;

  if (!role) {
    throw new AppError(`${code} role not found`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  return role;
}

async function invalidateAccountsByRole(roleId) {
  const scopedAccounts = await accessAssignmentRepository.findAccountIdsByRole(roleId);

  await invalidateAccounts(scopedAccounts);
}

function buildGlobalAssignments(accountId, roleIds, customPermissions = []) {
  return roleIds.map((roleId) => ({
    accountId,
    roleId,
    scopeType: accessScopeTypes.GLOBAL,
    scopeId: null,
    customPermissions,
    status: accessAssignmentStatuses.ACTIVE,
  }));
}

function uniqueIds(ids = []) {
  return [...new Set(ids.filter(Boolean).map((id) => String(id)))];
}

function normalizeAccountAssignments(assignments = []) {
  return assignments.map((assignment) => {
    const { scopeType, scopeId } = normalizeScopeInput(assignment.scopeType, assignment.scopeId);

    return {
      roleId: assignment.roleId,
      scopeType,
      scopeId,
      customPermissions: assignment.customPermissions || assignment.customPermissionIds || [],
      overridePermissions: assignment.overridePermissions ?? assignment.overridePermissionIds,
      validFrom: assignment.validFrom,
      validUntil: assignment.validUntil,
    };
  });
}

function buildAccessAssignments(accountId, assignments = []) {
  return assignments.map((assignment) => {
    const payload = {
      accountId,
      roleId: assignment.roleId,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      customPermissions: assignment.customPermissions,
      status: accessAssignmentStatuses.ACTIVE,
    };
    if (assignment.validFrom !== undefined) payload.validFrom = assignment.validFrom;
    if (assignment.validUntil !== undefined) payload.validUntil = assignment.validUntil;

    if (assignment.overridePermissions !== undefined) {
      payload.overridePermissions = assignment.overridePermissions;
    }

    return payload;
  });
}

function normalizeOptionalString(value) {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = String(value || '').trim();
  return normalizedValue || null;
}

function mapCreateAccountDuplicateError() {
  return new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

module.exports = {
  assertValidRegistryScopeType,
  buildAccessAssignments,
  buildGlobalAssignments,
  ensurePermissionsExist,
  ensureRoleByCode,
  ensureRolesExist,
  ensureScopeRegistered,
  findAccountsAffectedByPermission,
  invalidateAccounts,
  invalidateAccountsByRole,
  mapCreateAccountDuplicateError,
  normalizeAccountAssignments,
  normalizeOptionalString,
  normalizeScopeInput,
  uniqueIds,
};
