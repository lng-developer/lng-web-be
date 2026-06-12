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
const authManager = require('./authManager.service');
const { accountStatuses } = require('../constants/auth.constants');
const {
  toAccountDto,
  toProfileDto,
} = require('../dtos/auth.dto');
const {
  toRoleDto,
  toPermissionDto,
  toAccountListDto,
  toAccountAdminDto,
} = require('../dtos/admin.dto');

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
  const accountIds = [...new Set(accounts.map((account) => String(account._id)))];
  await Promise.all(accountIds.map((accountId) => authManager.invalidatePermissionCache(accountId)));
}

async function findAccountsAffectedByPermission(permissionId) {
  const [directAccounts, roles] = await Promise.all([
    accountRepository.findAccountIdsByCustomPermission(permissionId),
    roleRepository.findRoleIdsByPermission(permissionId),
  ]);
  const roleIds = roles.map((role) => role._id);
  const roleAccounts = roleIds.length > 0 ? await accountRepository.findAccountIdsByRoles(roleIds) : [];

  return [...directAccounts, ...roleAccounts];
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

  const affectedAccounts = await accountRepository.findAccountIdsByRole(roleId);
  await invalidateAccounts(affectedAccounts);

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
  const affectedAccounts = await accountRepository.findAccountIdsByRole(roleId);
  await invalidateAccounts(affectedAccounts);

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
  const affectedAccounts = await accountRepository.findAccountIdsByRole(roleId);
  await invalidateAccounts(affectedAccounts);

  return toRoleDto(updatedRole);
}

async function deleteRole(roleId) {
  assertValidObjectId(roleId, 'roleId');
  const usageCount = await accountRepository.countByRole(roleId);

  if (usageCount > 0) {
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
  const [customUsageCount, roleUsageCount] = await Promise.all([
    accountRepository.countByCustomPermission(permissionId),
    roleRepository.countByPermission(permissionId),
  ]);

  if (customUsageCount > 0) {
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
