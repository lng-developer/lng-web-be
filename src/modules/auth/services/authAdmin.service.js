const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const { hashPassword } = require('../../../shared/utils/crypto');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { normalizePagination, toPaginatedResponse } = require('../../../shared/utils/pagination');
const { normalizeLowercase, normalizeUppercase } = require('../../../shared/utils/string');
const accountRepository = require('../repositories/account.repository');
const userProfileRepository = require('../repositories/userProfile.repository');
const roleRepository = require('../repositories/role.repository');
const permissionRepository = require('../repositories/permission.repository');
const accessAssignmentRepository = require('../repositories/accessAssignment.repository');
const authManager = require('./authManager.service');
const {
  accountStatuses,
  accessAssignmentStatuses,
  accessScopeTypes,
} = require('../constants/auth.constants');
const {
  toAccountDto,
  toProfileDto,
} = require('../dtos/auth.dto');
const {
  toRoleDto,
  toPermissionDto,
  toAccountListDto,
  toAccountAdminDto,
  toAccessAssignmentDto,
} = require('../dtos/admin.dto');

const SCOPES_WITH_REQUIRED_ID = new Set([
  accessScopeTypes.DEPARTMENT,
  accessScopeTypes.TEAM,
  accessScopeTypes.SHOP,
  accessScopeTypes.VENDOR,
]);

async function ensureRolesExist(roleIds) {
  roleIds.forEach((roleId) => assertValidObjectId(roleId, 'roleId'));
  const roles = await roleRepository.findByIds(roleIds);

  if (roles.length !== roleIds.length) {
    throw new AppError('One or more roles were not found', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  return roles;
}

async function ensurePermissionsExist(permissionIds) {
  permissionIds.forEach((permissionId) => assertValidObjectId(permissionId, 'permissionId'));
  const permissions = await permissionRepository.findByIds(permissionIds);

  if (permissions.length !== permissionIds.length) {
    throw new AppError('One or more permissions were not found', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  return permissions;
}

async function invalidateAccounts(accounts) {
  const accountIds = [...new Set(accounts.map((account) => String(account._id || account.accountId)))];
  await Promise.all(accountIds.map((accountId) => authManager.invalidatePermissionCache(accountId)));
}

async function findAccountsAffectedByPermission(permissionId) {
  const [directAccounts, scopedDirectAccounts, roles] = await Promise.all([
    accountRepository.findAccountIdsByCustomPermission(permissionId),
    accessAssignmentRepository.findAccountIdsByCustomPermission(permissionId),
    roleRepository.findRoleIdsByPermission(permissionId),
  ]);
  const roleIds = roles.map((role) => role._id);
  const [roleAccounts, scopedRoleAccounts] = roleIds.length > 0
    ? await Promise.all([
      accountRepository.findAccountIdsByRoles(roleIds),
      Promise.all(roleIds.map((roleId) => accessAssignmentRepository.findAccountIdsByRole(roleId)))
        .then((results) => results.flat()),
    ])
    : [[], []];

  return [...directAccounts, ...scopedDirectAccounts, ...roleAccounts, ...scopedRoleAccounts];
}

function normalizeScopeInput(scopeType, scopeId) {
  if (!Object.values(accessScopeTypes).includes(scopeType)) {
    throw new AppError('scopeType is invalid', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  if (SCOPES_WITH_REQUIRED_ID.has(scopeType)) {
    assertValidObjectId(scopeId, 'scopeId');
    return { scopeType, scopeId };
  }

  if (scopeId) {
    assertValidObjectId(scopeId, 'scopeId');
  }

  return {
    scopeType,
    scopeId: null,
  };
}

async function invalidateAccountsByRole(roleId) {
  const [globalAccounts, scopedAccounts] = await Promise.all([
    accountRepository.findAccountIdsByRole(roleId),
    accessAssignmentRepository.findAccountIdsByRole(roleId),
  ]);

  await invalidateAccounts([...globalAccounts, ...scopedAccounts]);
}

async function createAccount({ email, password, fullName, roles, customPermissions = [] }) {
  const normalizedEmail = normalizeLowercase(email);
  const existingAccount = await accountRepository.findByNormalizedEmail(normalizedEmail);

  if (existingAccount) {
    throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  await ensureRolesExist(roles);
  await ensurePermissionsExist(customPermissions);

  const { passwordHash, passwordSalt } = await hashPassword(password);
  const session = await mongoose.startSession();

  try {
    let account;

    await session.withTransaction(async () => {
      account = await accountRepository.create({
        email: normalizedEmail,
        normalizedEmail,
        passwordHash,
        passwordSalt,
        roles,
        customPermissions,
        sessions: [],
        status: accountStatuses.ACTIVE,
      }, { session });

      await userProfileRepository.create({
        accountId: account._id,
        email: normalizedEmail,
        fullName,
      }, { session });
    });

    return getAccount(account._id);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

async function listAccounts(query = {}) {
  const result = await accountRepository.list({
    ...query,
    ...normalizePagination(query),
  });

  return toPaginatedResponse(result, toAccountListDto);
}

async function getAccount(accountId) {
  assertValidObjectId(accountId, 'accountId');
  const authModel = await accountRepository.findAuthAccountById(accountId);

  if (!authModel) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toAccountAdminDto(authModel);
}

async function updateAccountStatus(accountId, status) {
  assertValidObjectId(accountId, 'accountId');
  const account = await accountRepository.updateStatus(accountId, status);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authManager.invalidatePermissionCache(accountId);
  return toAccountDto(account);
}

async function updateAccountEmail(accountId, email) {
  assertValidObjectId(accountId, 'accountId');
  const normalizedEmail = normalizeLowercase(email);
  const account = await accountRepository.findById(accountId);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const existingAccount = await accountRepository.findByNormalizedEmail(normalizedEmail);

  if (existingAccount && String(existingAccount._id) !== String(accountId)) {
    throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const updatedAccount = await accountRepository.updateEmail(accountId, {
        email: normalizedEmail,
        normalizedEmail,
      }, { session });

      const updatedProfile = await userProfileRepository.updateByAccountId(accountId, {
        email: normalizedEmail,
      }, { session });

      if (!updatedAccount || !updatedProfile) {
        throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
    });

    await authManager.invalidatePermissionCache(accountId);
    return getAccount(accountId);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

async function updateProfile(accountId, update) {
  assertValidObjectId(accountId, 'accountId');
  const profile = await userProfileRepository.updateByAccountId(accountId, update);

  if (!profile) {
    throw new AppError('Profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toProfileDto(profile);
}

async function resetPassword(accountId, password) {
  assertValidObjectId(accountId, 'accountId');
  const passwordPayload = await hashPassword(password);
  const account = await accountRepository.updatePassword(accountId, passwordPayload);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toAccountDto(account);
}

async function archiveAccount(accountId) {
  assertValidObjectId(accountId, 'accountId');
  const account = await accountRepository.archive(accountId);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authManager.invalidatePermissionCache(accountId);
  return toAccountDto(account);
}

async function updateAccountAccess(accountId, { roles, customPermissions }) {
  assertValidObjectId(accountId, 'accountId');
  await ensureRolesExist(roles);
  await ensurePermissionsExist(customPermissions);

  const account = await accountRepository.updateAccess(accountId, {
    roles,
    customPermissions,
  });

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authManager.invalidatePermissionCache(accountId);
  return getAccount(accountId);
}

async function listAccessAssignments(query = {}) {
  const filters = { ...query };

  ['accountId', 'roleId', 'scopeId'].forEach((field) => {
    if (filters[field]) {
      assertValidObjectId(filters[field], field);
    }
  });

  const result = await accessAssignmentRepository.list({
    ...filters,
    ...normalizePagination(query),
  });

  return toPaginatedResponse(result, toAccessAssignmentDto);
}

async function getAccessAssignment(assignmentId) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const assignment = await accessAssignmentRepository.findById(assignmentId);

  if (!assignment) {
    throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toAccessAssignmentDto(assignment);
}

async function createAccessAssignment(payload) {
  assertValidObjectId(payload.accountId, 'accountId');
  assertValidObjectId(payload.roleId, 'roleId');
  const { scopeType, scopeId } = normalizeScopeInput(payload.scopeType, payload.scopeId);
  const customPermissions = payload.customPermissions || [];

  const [account, role] = await Promise.all([
    accountRepository.findById(payload.accountId),
    roleRepository.findById(payload.roleId),
    ensurePermissionsExist(customPermissions),
  ]);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  try {
    const assignment = await accessAssignmentRepository.create({
      accountId: payload.accountId,
      roleId: payload.roleId,
      scopeType,
      scopeId,
      customPermissions,
      status: accessAssignmentStatuses.ACTIVE,
    });

    await authManager.invalidatePermissionCache(payload.accountId);
    return toAccessAssignmentDto(assignment);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Access assignment already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function updateAccessAssignment(assignmentId, payload) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const existingAssignment = await accessAssignmentRepository.findById(assignmentId);

  if (!existingAssignment) {
    throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const update = {};

  if (payload.roleId !== undefined) {
    assertValidObjectId(payload.roleId, 'roleId');
    const role = await roleRepository.findById(payload.roleId);

    if (!role) {
      throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }

    update.roleId = payload.roleId;
  }

  if (payload.scopeType !== undefined || payload.scopeId !== undefined) {
    const normalizedScope = normalizeScopeInput(
      payload.scopeType || existingAssignment.scopeType,
      payload.scopeId !== undefined ? payload.scopeId : existingAssignment.scopeId,
    );
    update.scopeType = normalizedScope.scopeType;
    update.scopeId = normalizedScope.scopeId;
  }

  if (payload.customPermissions !== undefined) {
    await ensurePermissionsExist(payload.customPermissions);
    update.customPermissions = payload.customPermissions;
  }

  if (payload.status !== undefined) {
    update.status = payload.status;
  }

  try {
    const assignment = await accessAssignmentRepository.update(assignmentId, update);
    await authManager.invalidatePermissionCache(existingAssignment.accountId);
    return toAccessAssignmentDto(assignment);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Access assignment already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function deactivateAccessAssignment(assignmentId) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const existingAssignment = await accessAssignmentRepository.findById(assignmentId);

  if (!existingAssignment) {
    throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const assignment = await accessAssignmentRepository.deactivate(assignmentId);
  await authManager.invalidatePermissionCache(existingAssignment.accountId);

  return toAccessAssignmentDto(assignment);
}

async function listRoles(query = {}) {
  const result = await roleRepository.list({
    ...query,
    ...normalizePagination(query),
  });

  return toPaginatedResponse(result, toRoleDto);
}

async function getRole(roleId) {
  assertValidObjectId(roleId, 'roleId');
  const role = await roleRepository.findById(roleId);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toRoleDto(role);
}

async function createRole(payload) {
  const code = normalizeUppercase(payload.code);
  const existingRole = await roleRepository.findByCode(code);

  if (existingRole) {
    throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  await ensurePermissionsExist(payload.permissions || []);

  try {
    const role = await roleRepository.create({
      name: payload.name,
      code,
      permissions: payload.permissions || [],
    });

    return toRoleDto(role);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function updateRole(roleId, payload) {
  assertValidObjectId(roleId, 'roleId');
  const update = {};

  if (payload.name !== undefined) {
    update.name = payload.name;
  }

  if (payload.code !== undefined) {
    update.code = normalizeUppercase(payload.code);
    const existingRole = await roleRepository.findByCode(update.code);

    if (existingRole && String(existingRole._id) !== String(roleId)) {
      throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
  }

  if (payload.permissions !== undefined) {
    await ensurePermissionsExist(payload.permissions);
    update.permissions = payload.permissions;
  }

  let role;

  try {
    role = await roleRepository.update(roleId, update);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await invalidateAccountsByRole(roleId);

  return toRoleDto(role);
}

async function addRolePermission(roleId, permissionId) {
  assertValidObjectId(roleId, 'roleId');
  assertValidObjectId(permissionId, 'permissionId');

  const [role, permission] = await Promise.all([
    roleRepository.findById(roleId),
    permissionRepository.findById(permissionId),
  ]);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (!permission) {
    throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const updatedRole = await roleRepository.addPermission(roleId, permissionId);
  await invalidateAccountsByRole(roleId);

  return toRoleDto(updatedRole);
}

async function removeRolePermission(roleId, permissionId) {
  assertValidObjectId(roleId, 'roleId');
  assertValidObjectId(permissionId, 'permissionId');

  const role = await roleRepository.findById(roleId);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const updatedRole = await roleRepository.removePermission(roleId, permissionId);
  await invalidateAccountsByRole(roleId);

  return toRoleDto(updatedRole);
}

async function deleteRole(roleId) {
  assertValidObjectId(roleId, 'roleId');
  const [usageCount, scopedUsageCount] = await Promise.all([
    accountRepository.countByRole(roleId),
    accessAssignmentRepository.countByRole(roleId),
  ]);

  if (usageCount > 0 || scopedUsageCount > 0) {
    throw new AppError('Role is assigned to accounts', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const role = await roleRepository.deleteById(roleId);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toRoleDto(role);
}

async function listPermissions(query = {}) {
  const result = await permissionRepository.list({
    ...query,
    ...normalizePagination(query),
  });

  return toPaginatedResponse(result, toPermissionDto);
}

async function getPermission(permissionId) {
  assertValidObjectId(permissionId, 'permissionId');
  const permission = await permissionRepository.findById(permissionId);

  if (!permission) {
    throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toPermissionDto(permission);
}

async function createPermission(payload) {
  const code = normalizeUppercase(payload.code);
  const existingPermission = await permissionRepository.findByCode(code);

  if (existingPermission) {
    throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  try {
    const permission = await permissionRepository.create({ code });
    return toPermissionDto(permission);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function updatePermission(permissionId, payload) {
  assertValidObjectId(permissionId, 'permissionId');
  const code = normalizeUppercase(payload.code);
  const existingPermission = await permissionRepository.findByCode(code);

  if (existingPermission && String(existingPermission._id) !== String(permissionId)) {
    throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  let permission;

  try {
    permission = await permissionRepository.update(permissionId, { code });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }

  if (!permission) {
    throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const affectedAccounts = await findAccountsAffectedByPermission(permissionId);
  await invalidateAccounts(affectedAccounts);

  return toPermissionDto(permission);
}

async function deletePermission(permissionId) {
  assertValidObjectId(permissionId, 'permissionId');
  const [customUsageCount, scopedCustomUsageCount, roleUsageCount] = await Promise.all([
    accountRepository.countByCustomPermission(permissionId),
    accessAssignmentRepository.countByCustomPermission(permissionId),
    roleRepository.countByPermission(permissionId),
  ]);

  if (customUsageCount > 0 || scopedCustomUsageCount > 0) {
    throw new AppError('Permission is assigned directly to accounts', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  if (roleUsageCount > 0) {
    throw new AppError('Permission is assigned to roles', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const permission = await permissionRepository.deleteById(permissionId);

  if (!permission) {
    throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toPermissionDto(permission);
}

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
  updateAccountStatus,
  updateAccountEmail,
  updateProfile,
  resetPassword,
  archiveAccount,
  updateAccountAccess,
  listAccessAssignments,
  getAccessAssignment,
  createAccessAssignment,
  updateAccessAssignment,
  deactivateAccessAssignment,
  listRoles,
  getRole,
  createRole,
  updateRole,
  addRolePermission,
  removeRolePermission,
  deleteRole,
  listPermissions,
  getPermission,
  createPermission,
  updatePermission,
  deletePermission,
};
