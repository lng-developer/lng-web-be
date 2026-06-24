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
const scopeRegistryRepository = require('../repositories/scopeRegistry.repository');
const scopedRolePermissionRepository = require('../repositories/scopedRolePermission.repository');
const authManager = require('./authManager.service');
const {
  roleCodes,
  accountStatuses,
  accessAssignmentStatuses,
  accessScopeTypes,
  scopeRegistryStatuses,
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
  toScopeRegistryDto,
  toScopedRolePermissionDto,
} = require('../dtos/admin.dto');

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

async function ensureScopeRegistered(scopeType, scopeId) {
  if (!SCOPES_WITH_REQUIRED_ID.has(scopeType)) {
    return;
  }

  const registryEntry = await scopeRegistryRepository.findActiveByScope(scopeType, scopeId);

  if (!registryEntry) {
    throw new AppError('Scope is not registered or inactive', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

async function ensureRoleByCode(code) {
  const role = await roleRepository.findByCode(code);

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
    };
  });
}

function buildAccessAssignments(accountId, assignments = []) {
  return assignments.map((assignment) => ({
    accountId,
    roleId: assignment.roleId,
    scopeType: assignment.scopeType,
    scopeId: assignment.scopeId,
    customPermissions: assignment.customPermissions,
    status: accessAssignmentStatuses.ACTIVE,
  }));
}

function normalizeOptionalString(value) {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = String(value || '').trim();
  return normalizedValue || null;
}

function getDuplicateKeyFields(error) {
  return Object.keys(error?.keyPattern || error?.keyValue || {});
}

function mapCreateAccountDuplicateError(error) {
  const duplicateFields = getDuplicateKeyFields(error);

  if (duplicateFields.includes('employeeCode')) {
    return new AppError('Employee code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  return new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

function getOrganizationPublic() {
  return require('../../organization/public');
}

function getShopPublic() {
  return require('../../shop/public');
}

function buildById(items = []) {
  return new Map(items.map((item) => [String(item._id || item.id), item]));
}

function compactResource(resource) {
  if (!resource) {
    return null;
  }

  return {
    id: String(resource._id || resource.id),
    name: resource.name || null,
    code: resource.code || null,
    currency: resource.currency || null,
    status: resource.status || null,
  };
}

async function findScopeRegistryByScope(scopeType, scopeId) {
  const result = await scopeRegistryRepository.list({
    scopeType,
    scopeId,
    page: 1,
    limit: 1,
  });

  return result?.items?.[0] || null;
}

async function resolveScopeResource(scopeType, scopeId) {
  try {
    if (scopeType === accessScopeTypes.DEPARTMENT) {
      return {
        resource: compactResource(await getOrganizationPublic().getDepartmentById(scopeId)),
        parentDepartment: null,
      };
    }

    if (scopeType === accessScopeTypes.TEAM) {
      const team = await getOrganizationPublic().getTeamById(scopeId);
      const department = team?.departmentId
        ? await getOrganizationPublic().getDepartmentById(team.departmentId)
        : null;

      return {
        resource: compactResource(team),
        parentDepartment: compactResource(department),
      };
    }

    if (scopeType === accessScopeTypes.SHOP) {
      return {
        resource: compactResource(await getShopPublic().findById(scopeId)),
        parentDepartment: null,
      };
    }
  } catch (error) {
    return { resource: null, parentDepartment: null };
  }

  return { resource: null, parentDepartment: null };
}

async function enrichScopesWithMetadata(scopes = []) {
  return Promise.all(scopes.map(async (scope) => {
    const [assignmentCount, resourceInfo] = await Promise.all([
      accessAssignmentRepository.countActiveByScope(scope.scopeType, scope.scopeId),
      resolveScopeResource(scope.scopeType, scope.scopeId),
    ]);

    return {
      ...scope,
      assignmentCount,
      ...resourceInfo,
    };
  }));
}

async function enrichAuthModelScopes(authModel) {
  const scopes = await Promise.all((authModel.scopes || []).map(async (scope) => {
    if (scope.scopeType === accessScopeTypes.GLOBAL || !scope.scopeId) {
      return scope;
    }

    const [registryEntry, resourceInfo] = await Promise.all([
      findScopeRegistryByScope(scope.scopeType, scope.scopeId),
      resolveScopeResource(scope.scopeType, scope.scopeId),
    ]);

    return {
      ...scope,
      scopeName: registryEntry?.name || resourceInfo.resource?.name || null,
      scope: registryEntry ? {
        ...registryEntry,
        ...resourceInfo,
      } : null,
      ...resourceInfo,
    };
  }));

  return { ...authModel, scopes };
}

async function getPermissionDetails(permissionIds = []) {
  const ids = uniqueIds(permissionIds);

  if (ids.length === 0) {
    return [];
  }

  const permissions = await permissionRepository.findByIds(ids);
  const permissionById = buildById(permissions);

  return ids.map((permissionId) => permissionById.get(String(permissionId))).filter(Boolean);
}

async function enrichRolesWithPermissionDetails(roles = [], { includePermissionDetails = true } = {}) {
  const allPermissionIds = includePermissionDetails
    ? uniqueIds(roles.flatMap((role) => role.permissions || []))
    : [];
  const permissionDetails = await getPermissionDetails(allPermissionIds);
  const permissionById = buildById(permissionDetails);

  return Promise.all(roles.map(async (role) => {
    const userCount = await accessAssignmentRepository.countByRole(role._id || role.id);

    return {
      ...role,
      userCount,
      deletable: userCount === 0,
      permissionDetails: includePermissionDetails ? (role.permissions || [])
        .map((permissionId) => permissionById.get(String(permissionId)))
        .filter(Boolean) : undefined,
    };
  }));
}

async function enrichPermissionsWithUsage(permissions = []) {
  return Promise.all(permissions.map(async (permission) => {
    const permissionId = permission._id || permission.id;
    const [roleCount, scopedRoleCount, directAssignmentCount] = await Promise.all([
      roleRepository.countByPermission(permissionId),
      scopedRolePermissionRepository.countByPermission(permissionId),
      accessAssignmentRepository.countByCustomPermission(permissionId),
    ]);
    const usageCount = Number(roleCount || 0) + Number(scopedRoleCount || 0) + Number(directAssignmentCount || 0);

    return {
      ...permission,
      roleCount,
      scopedRoleCount,
      directAssignmentCount,
      usageCount,
      deletable: usageCount === 0,
    };
  }));
}

async function enrichAccessAssignments(assignments = []) {
  const roleIds = uniqueIds(assignments.map((assignment) => assignment.roleId));
  const customPermissionIds = uniqueIds(assignments.flatMap((assignment) => assignment.customPermissions || []));
  const [roles, customPermissionDetails] = await Promise.all([
    roleIds.length > 0 ? roleRepository.findByIds(roleIds) : [],
    getPermissionDetails(customPermissionIds),
  ]);
  const roleById = buildById(roles || []);
  const permissionById = buildById(customPermissionDetails);

  return Promise.all(assignments.map(async (assignment) => {
    const scope = assignment.scopeId
      ? await findScopeRegistryByScope(assignment.scopeType, assignment.scopeId)
      : null;
    const resourceInfo = assignment.scopeId
      ? await resolveScopeResource(assignment.scopeType, assignment.scopeId)
      : { resource: null, parentDepartment: null };

    return {
      ...assignment,
      role: roleById.get(String(assignment.roleId)) || null,
      scope: scope ? { ...scope, ...resourceInfo } : null,
      customPermissionDetails: (assignment.customPermissions || [])
        .map((permissionId) => permissionById.get(String(permissionId)))
        .filter(Boolean),
    };
  }));
}

async function enrichScopedRolePermissions(rules = []) {
  const roleIds = uniqueIds(rules.map((rule) => rule.roleId));
  const permissionIds = uniqueIds(rules.flatMap((rule) => rule.permissions || []));
  const [roles, permissionDetails] = await Promise.all([
    roleIds.length > 0 ? roleRepository.findByIds(roleIds) : [],
    getPermissionDetails(permissionIds),
  ]);
  const roleItems = roles || [];
  const roleById = buildById(roleItems);
  const permissionById = buildById(permissionDetails);
  const defaultPermissionDetails = await getPermissionDetails(
    roleItems.flatMap((role) => role.permissions || []),
  );
  const defaultPermissionById = buildById(defaultPermissionDetails);

  return Promise.all(rules.map(async (rule) => {
    const role = roleById.get(String(rule.roleId)) || null;
    const registryEntry = await findScopeRegistryByScope(rule.scopeType, rule.scopeId);
    const resourceInfo = await resolveScopeResource(rule.scopeType, rule.scopeId);

    return {
      ...rule,
      role,
      scope: registryEntry ? { ...registryEntry, ...resourceInfo } : null,
      permissionDetails: (rule.permissions || [])
        .map((permissionId) => permissionById.get(String(permissionId)))
        .filter(Boolean),
      defaultPermissions: role?.permissions || [],
      defaultPermissionDetails: (role?.permissions || [])
        .map((permissionId) => defaultPermissionById.get(String(permissionId)))
        .filter(Boolean),
    };
  }));
}

async function enrichAccountsWithOrganization(items = []) {
  const accountIds = items.map((account) => String(account._id || account.id));
  const organizationPublic = getOrganizationPublic();
  const summaries = await organizationPublic.listAccountOrganizationSummaries(accountIds);
  const summaryByAccountId = new Map(
    summaries.map((summary) => [String(summary.accountId), summary]),
  );

  return items.map((account) => ({
    ...account,
    organization: summaryByAccountId.get(String(account._id || account.id)) || null,
  }));
}

async function createAccount({ email, password, fullName, assignments = [] }) {
  const normalizedEmail = normalizeLowercase(email);
  const existingAccount = await accountRepository.findByNormalizedEmail(normalizedEmail);

  if (existingAccount) {
    throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const normalizedAssignments = normalizeAccountAssignments(assignments);
  const roleIds = uniqueIds(normalizedAssignments.map((assignment) => assignment.roleId));
  const customPermissionIds = uniqueIds(
    normalizedAssignments.flatMap((assignment) => assignment.customPermissions),
  );

  await ensureRolesExist(roleIds);
  await ensurePermissionsExist(customPermissionIds);
  await Promise.all(normalizedAssignments.map((assignment) => (
    ensureScopeRegistered(assignment.scopeType, assignment.scopeId)
  )));

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
        sessions: [],
        status: accountStatuses.ACTIVE,
      }, { session });

      await userProfileRepository.create({
        accountId: account._id,
        email: normalizedEmail,
        fullName,
      }, { session });

      await accessAssignmentRepository.createMany(
        buildAccessAssignments(account._id, normalizedAssignments),
        { session },
      );
    });

    return getAccount(account._id);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw mapCreateAccountDuplicateError(error);
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

  const items = await enrichAccountsWithOrganization(result.items);

  return toPaginatedResponse({
    ...result,
    items,
  }, toAccountListDto);
}

async function getAccount(accountId) {
  assertValidObjectId(accountId, 'accountId');
  const authModel = await accountRepository.findAuthAccountById(accountId);

  if (!authModel) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toAccountAdminDto(await enrichAuthModelScopes(authModel));
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

async function revokeAccountSessions(accountId) {
  assertValidObjectId(accountId, 'accountId');
  const account = await accountRepository.revokeActiveSessions(accountId);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authManager.invalidatePermissionCache(accountId);

  return {
    revoked: true,
    account: toAccountDto(account),
  };
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

  const account = await accountRepository.findById(accountId);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await accessAssignmentRepository.deactivateActiveGlobalByAccount(accountId, { session });
      await accessAssignmentRepository.createMany(
        buildGlobalAssignments(accountId, roles, customPermissions),
        { session },
      );
    });

    await authManager.invalidatePermissionCache(accountId);
    return getAccount(accountId);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Access assignment already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  } finally {
    await session.endSession();
  }
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

  return toPaginatedResponse({
    ...result,
    items: await enrichAccessAssignments(result.items),
  }, toAccessAssignmentDto);
}

async function listScopes(query = {}) {
  const filters = { ...query };

  if (filters.scopeType) {
    assertValidRegistryScopeType(filters.scopeType);
  }

  if (filters.scopeId) {
    assertValidObjectId(filters.scopeId, 'scopeId');
  }

  const result = await scopeRegistryRepository.list({
    ...filters,
    ...normalizePagination(query),
  });

  return toPaginatedResponse({
    ...result,
    items: await enrichScopesWithMetadata(result.items),
  }, toScopeRegistryDto);
}

async function createScope(payload) {
  assertValidRegistryScopeType(payload.scopeType);
  assertValidObjectId(payload.scopeId, 'scopeId');

  try {
    const scope = await scopeRegistryRepository.create({
      scopeType: payload.scopeType,
      scopeId: payload.scopeId,
      name: payload.name,
      status: scopeRegistryStatuses.ACTIVE,
    });

    return toScopeRegistryDto((await enrichScopesWithMetadata([scope]))[0]);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Scope is already registered', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function syncScopeRegistry(payload) {
  assertValidRegistryScopeType(payload.scopeType);
  assertValidObjectId(payload.scopeId, 'scopeId');

  const scope = await scopeRegistryRepository.upsertByScope({
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    name: payload.name,
    status: payload.status || scopeRegistryStatuses.ACTIVE,
  });

  return toScopeRegistryDto((await enrichScopesWithMetadata([scope]))[0]);
}

async function getScope(scopeRegistryId) {
  assertValidObjectId(scopeRegistryId, 'scopeRegistryId');
  const scope = await scopeRegistryRepository.findById(scopeRegistryId);

  if (!scope) {
    throw new AppError('Scope registry entry not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toScopeRegistryDto((await enrichScopesWithMetadata([scope]))[0]);
}

async function updateScope(scopeRegistryId, payload) {
  assertValidObjectId(scopeRegistryId, 'scopeRegistryId');
  const existingScope = await scopeRegistryRepository.findById(scopeRegistryId);

  if (!existingScope) {
    throw new AppError('Scope registry entry not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (payload.status === scopeRegistryStatuses.INACTIVE) {
    const usageCount = await accessAssignmentRepository.countActiveByScope(
      existingScope.scopeType,
      existingScope.scopeId,
    );

    if (usageCount > 0) {
      throw new AppError('Scope is assigned to active access assignments', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
  }

  const scope = await scopeRegistryRepository.update(scopeRegistryId, payload);
  return toScopeRegistryDto((await enrichScopesWithMetadata([scope]))[0]);
}

async function deactivateScope(scopeRegistryId) {
  return updateScope(scopeRegistryId, { status: scopeRegistryStatuses.INACTIVE });
}

async function getAccessAssignment(assignmentId) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const assignment = await accessAssignmentRepository.findById(assignmentId);

  if (!assignment) {
    throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
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

  await ensureScopeRegistered(scopeType, scopeId);

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
    return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
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
    await ensureScopeRegistered(normalizedScope.scopeType, normalizedScope.scopeId);
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
    return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
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

  return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
}

async function listRoles(query = {}) {
  const result = await roleRepository.list({
    ...query,
    ...normalizePagination(query),
  });
  const items = await enrichRolesWithPermissionDetails(result.items, { includePermissionDetails: false });

  return toPaginatedResponse({
    ...result,
    items,
  }, (role) => toRoleDto(role, { includePermissionDetails: false }));
}

async function getRole(roleId) {
  assertValidObjectId(roleId, 'roleId');
  const role = await roleRepository.findById(roleId);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toRoleDto((await enrichRolesWithPermissionDetails([role]))[0]);
}

async function createRole(payload) {
  const code = normalizeUppercase(payload.code);
  const description = normalizeOptionalString(payload.description);
  const existingRole = await roleRepository.findByCode(code);

  if (existingRole) {
    throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  await ensurePermissionsExist(payload.permissions || []);

  try {
    const role = await roleRepository.create({
      name: payload.name,
      code,
      description,
      permissions: payload.permissions || [],
    });

    return toRoleDto((await enrichRolesWithPermissionDetails([role]))[0]);
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

  const description = normalizeOptionalString(payload.description);

  if (description !== undefined) {
    update.description = description;
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

  return toRoleDto((await enrichRolesWithPermissionDetails([role]))[0]);
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

  return toRoleDto((await enrichRolesWithPermissionDetails([updatedRole]))[0]);
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

  return toRoleDto((await enrichRolesWithPermissionDetails([updatedRole]))[0]);
}

async function setScopedRolePermissions({ scopeType, scopeId, roleId, permissionIds }) {
  assertValidObjectId(roleId, 'roleId');
  assertValidRegistryScopeType(scopeType);
  const normalizedScope = normalizeScopeInput(scopeType, scopeId);

  const [role] = await Promise.all([
    roleRepository.findById(roleId),
    ensureScopeRegistered(normalizedScope.scopeType, normalizedScope.scopeId),
    ensurePermissionsExist(permissionIds || []),
  ]);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const rule = await scopedRolePermissionRepository.upsert({
    scopeType: normalizedScope.scopeType,
    scopeId: normalizedScope.scopeId,
    roleId,
    permissions: permissionIds || [],
  });
  await invalidateAccountsByRole(roleId);

  return toScopedRolePermissionDto((await enrichScopedRolePermissions([rule]))[0]);
}

async function listScopedRolePermissions(query = {}) {
  const filters = { ...query };

  ['scopeId', 'roleId'].forEach((field) => {
    if (filters[field]) {
      assertValidObjectId(filters[field], field);
    }
  });

  if (filters.scopeType) {
    assertValidRegistryScopeType(filters.scopeType);
  }

  const result = await scopedRolePermissionRepository.list({
    ...filters,
    ...normalizePagination(query),
  });

  return toPaginatedResponse({
    ...result,
    items: await enrichScopedRolePermissions(result.items),
  }, toScopedRolePermissionDto);
}

async function ensureTeamLeaderAssignment(accountId, teamId, options = {}) {
  assertValidObjectId(accountId, 'accountId');
  assertValidObjectId(teamId, 'teamId');

  const [account, leaderRole, userRole] = await Promise.all([
    accountRepository.findById(accountId),
    ensureRoleByCode(roleCodes.LEADER),
    ensureRoleByCode(roleCodes.USER),
    ensureScopeRegistered(accessScopeTypes.TEAM, teamId),
  ]);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const assignment = await accessAssignmentRepository.upsertActiveScopedRole({
    accountId,
    roleId: leaderRole._id,
    scopeType: accessScopeTypes.TEAM,
    scopeId: teamId,
    customPermissions: [],
    status: accessAssignmentStatuses.ACTIVE,
  }, options);

  await accessAssignmentRepository.deactivateActiveByAccountRoleScope(
    accountId,
    userRole._id,
    accessScopeTypes.TEAM,
    teamId,
    options,
  );
  await authManager.invalidatePermissionCache(accountId);

  return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
}

async function ensureTeamMemberAssignment(accountId, teamId, options = {}) {
  assertValidObjectId(accountId, 'accountId');
  assertValidObjectId(teamId, 'teamId');

  const [account, userRole, leaderRole] = await Promise.all([
    accountRepository.findById(accountId),
    ensureRoleByCode(roleCodes.USER),
    ensureRoleByCode(roleCodes.LEADER),
    ensureScopeRegistered(accessScopeTypes.TEAM, teamId),
  ]);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const assignment = await accessAssignmentRepository.upsertActiveScopedRole({
    accountId,
    roleId: userRole._id,
    scopeType: accessScopeTypes.TEAM,
    scopeId: teamId,
    customPermissions: [],
    status: accessAssignmentStatuses.ACTIVE,
  }, options);

  await accessAssignmentRepository.deactivateActiveByAccountRoleScope(
    accountId,
    leaderRole._id,
    accessScopeTypes.TEAM,
    teamId,
    options,
  );
  await authManager.invalidatePermissionCache(accountId);

  return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
}

async function deactivateTeamRoleAssignments(accountId, teamId, options = {}) {
  assertValidObjectId(accountId, 'accountId');
  assertValidObjectId(teamId, 'teamId');

  const [leaderRole, userRole] = await Promise.all([
    ensureRoleByCode(roleCodes.LEADER),
    ensureRoleByCode(roleCodes.USER),
  ]);

  await Promise.all([
    accessAssignmentRepository.deactivateActiveByAccountRoleScope(
      accountId,
      leaderRole._id,
      accessScopeTypes.TEAM,
      teamId,
      options,
    ),
    accessAssignmentRepository.deactivateActiveByAccountRoleScope(
      accountId,
      userRole._id,
      accessScopeTypes.TEAM,
      teamId,
      options,
    ),
  ]);
  await authManager.invalidatePermissionCache(accountId);

  return { deactivated: true };
}

async function deleteRole(roleId) {
  assertValidObjectId(roleId, 'roleId');
  const usageCount = await accessAssignmentRepository.countByRole(roleId);

  if (usageCount > 0) {
    throw new AppError('Role is assigned to accounts', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const role = await roleRepository.deleteById(roleId);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toRoleDto((await enrichRolesWithPermissionDetails([role]))[0]);
}

async function listPermissions(query = {}) {
  const result = await permissionRepository.list({
    ...query,
    ...normalizePagination(query),
  });

  return toPaginatedResponse({
    ...result,
    items: await enrichPermissionsWithUsage(result.items),
  }, toPermissionDto);
}

async function getPermission(permissionId) {
  assertValidObjectId(permissionId, 'permissionId');
  const permission = await permissionRepository.findById(permissionId);

  if (!permission) {
    throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toPermissionDto((await enrichPermissionsWithUsage([permission]))[0]);
}

async function createPermission(payload) {
  const code = normalizeUppercase(payload.code);
  const name = normalizeOptionalString(payload.name);
  const description = normalizeOptionalString(payload.description);
  const existingPermission = await permissionRepository.findByCode(code);

  if (existingPermission) {
    throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  try {
    const permission = await permissionRepository.create({ code, name, description });
    return toPermissionDto((await enrichPermissionsWithUsage([permission]))[0]);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function updatePermission(permissionId, payload) {
  assertValidObjectId(permissionId, 'permissionId');
  const update = {};

  if (payload.code !== undefined) {
    const code = normalizeUppercase(payload.code);
    const existingPermission = await permissionRepository.findByCode(code);

    if (existingPermission && String(existingPermission._id) !== String(permissionId)) {
      throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    update.code = code;
  }

  const name = normalizeOptionalString(payload.name);
  const description = normalizeOptionalString(payload.description);

  if (name !== undefined) {
    update.name = name;
  }

  if (description !== undefined) {
    update.description = description;
  }

  let permission;

  try {
    permission = await permissionRepository.update(permissionId, update);
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

  return toPermissionDto((await enrichPermissionsWithUsage([permission]))[0]);
}

async function deletePermission(permissionId) {
  assertValidObjectId(permissionId, 'permissionId');
  const [customUsageCount, roleUsageCount, scopedRoleUsageCount] = await Promise.all([
    accessAssignmentRepository.countByCustomPermission(permissionId),
    roleRepository.countByPermission(permissionId),
    scopedRolePermissionRepository.countByPermission(permissionId),
  ]);

  if (customUsageCount > 0) {
    throw new AppError('Permission is assigned directly to accounts', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  if (roleUsageCount > 0 || scopedRoleUsageCount > 0) {
    throw new AppError('Permission is assigned to roles or scoped role rules', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const permission = await permissionRepository.deleteById(permissionId);

  if (!permission) {
    throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toPermissionDto((await enrichPermissionsWithUsage([permission]))[0]);
}

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
  updateAccountStatus,
  updateAccountEmail,
  updateProfile,
  resetPassword,
  revokeAccountSessions,
  archiveAccount,
  updateAccountAccess,
  listAccessAssignments,
  listScopes,
  createScope,
  syncScopeRegistry,
  getScope,
  updateScope,
  deactivateScope,
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
  setScopedRolePermissions,
  listScopedRolePermissions,
  ensureTeamLeaderAssignment,
  ensureTeamMemberAssignment,
  deactivateTeamRoleAssignments,
  deleteRole,
  listPermissions,
  getPermission,
  createPermission,
  updatePermission,
  deletePermission,
};
