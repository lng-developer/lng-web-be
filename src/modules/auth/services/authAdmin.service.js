const mongoose = require('mongoose');
const crypto = require('crypto');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const { hashPassword } = require('../../../shared/utils/crypto');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { normalizePagination, toPaginatedResponse } = require('../../../shared/utils/pagination');
const { normalizeLowercase, normalizeUppercase } = require('../../../shared/utils/string');
const accountRepository = require('../repositories/account.repository');
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
const {
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
} = require('./authAdmin.helpers');
const {
  enrichAccessAssignments,
  enrichAccountsWithOrganization,
  enrichAuthModelScopes,
  enrichPermissionsWithUsage,
  enrichRolesWithPermissionDetails,
  enrichScopedRolePermissions,
  enrichScopesWithMetadata,
} = require('./authAdmin.enrichment');

function isSuperAdmin(authContext) {
  return (authContext?.roles || []).includes(roleCodes.SUPER_ADMIN);
}

function getAuditPublic() {
  return require('../../audit/public');
}

function changedFields(before = {}, after = {}, fields = Object.keys(after)) {
  return fields.reduce((changes, field) => {
    const previous = before[field] ?? null;
    const next = after[field] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next)) changes[field] = { before: previous, after: next };
    return changes;
  }, {});
}

async function recordAdminAudit({
  action,
  entityType,
  entityId,
  scopeType = null,
  scopeId = null,
  changes = {},
  metadata = {},
}, authContext, httpContext, operationId, session) {
  const actorAccountId = authContext?.accountId || null;
  const normalizedScopeId = scopeId == null ? null : String(scopeId);
  return getAuditPublic().record({
    actorType: actorAccountId ? 'ACCOUNT' : 'SYSTEM',
    actorAccountId,
    actorSnapshot: {},
    action,
    entityType,
    entityId: String(entityId),
    scopeType: normalizedScopeId && scopeType ? String(scopeType).toUpperCase() : null,
    scopeId: normalizedScopeId,
    outcome: 'SUCCEEDED',
    source: httpContext ? 'HTTP' : 'SYSTEM',
    requestId: httpContext?.requestId || null,
    ipAddress: httpContext?.ipAddress || null,
    userAgent: httpContext?.userAgent || null,
    changes,
    metadata,
    deduplicationKey: `auth-admin:${action.toLowerCase()}:${operationId}`,
  }, { session });
}

async function runAdminMutation(authContext, httpContext, mutate, buildEvent) {
  const operationId = crypto.randomUUID();
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await mutate(session);
      const event = buildEvent(result);
      if (event) await recordAdminAudit(event, authContext, httpContext, operationId, session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function assertCanManageSuperAdmin(authContext, role, scopeType = accessScopeTypes.GLOBAL) {
  if (role?.code !== roleCodes.SUPER_ADMIN) {
    return;
  }

  if (scopeType !== accessScopeTypes.GLOBAL) {
    throw new AppError('SUPER_ADMIN must use global scope', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  if (!isSuperAdmin(authContext)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

async function createAccount({ email, password, assignments = [] }, authContext, httpContext) {
  const normalizedEmail = normalizeLowercase(email);
  const existingAccount = await accountRepository.findByEmail(normalizedEmail);

  if (existingAccount) {
    throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const normalizedAssignments = normalizeAccountAssignments(assignments);
  const roleIds = uniqueIds(normalizedAssignments.map((assignment) => assignment.roleId));
  const customPermissionIds = uniqueIds(
    normalizedAssignments.flatMap((assignment) => assignment.customPermissions),
  );
  const overridePermissionIds = uniqueIds(
    normalizedAssignments.flatMap((assignment) => (
      Array.isArray(assignment.overridePermissions) ? assignment.overridePermissions : []
    )),
  );

  const roles = await ensureRolesExist(roleIds);
  await ensurePermissionsExist([...customPermissionIds, ...overridePermissionIds]);
  await Promise.all(normalizedAssignments.map((assignment) => (
    ensureScopeRegistered(assignment.scopeType, assignment.scopeId)
  )));
  normalizedAssignments.forEach((assignment) => {
    assertCanManageSuperAdmin(
      authContext,
      roles.find((role) => String(role._id) === String(assignment.roleId)),
      assignment.scopeType,
    );
  });

  const { passwordHash, passwordSalt } = await hashPassword(password);
  const operationId = crypto.randomUUID();
  const session = await mongoose.startSession();

  try {
    let account;

    await session.withTransaction(async () => {
      account = await accountRepository.create({
        email: normalizedEmail,
        passwordHash,
        passwordSalt,
        sessions: [],
        status: accountStatuses.ACTIVE,
      }, { session });

      await accessAssignmentRepository.createMany(
        buildAccessAssignments(account._id, normalizedAssignments),
        { session },
      );
      await recordAdminAudit({
        action: 'ACCOUNT_CREATED',
        entityType: 'AUTH_ACCOUNT',
        entityId: account._id,
        changes: {
          status: { after: accountStatuses.ACTIVE },
          assignmentCount: { after: normalizedAssignments.length },
        },
      }, authContext, httpContext, operationId, session);
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

async function updateAccountStatus(accountId, status, authContext, httpContext) {
  assertValidObjectId(accountId, 'accountId');
  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await accountRepository.findById(accountId, { session });
    const account = await accountRepository.updateStatus(accountId, status, { session });
    return { before, account };
  }, ({ before, account }) => account && ({
    action: 'ACCOUNT_STATUS_UPDATED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
    changes: changedFields(before, account, ['status']),
    metadata: { noOp: before?.status === account?.status },
  }));
  const { account } = mutation;

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authManager.invalidatePermissionCache(accountId);
  return toAccountDto(account);
}

async function updateAccountEmail(accountId, email, authContext, httpContext) {
  assertValidObjectId(accountId, 'accountId');
  const normalizedEmail = normalizeLowercase(email);
  const account = await accountRepository.findById(accountId);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const existingAccount = await accountRepository.findByEmail(normalizedEmail);

  if (existingAccount && String(existingAccount._id) !== String(accountId)) {
    throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  try {
    const updatedAccount = await runAdminMutation(authContext, httpContext, (session) => (
      accountRepository.updateEmail(accountId, normalizedEmail, { session })
    ), (updated) => updated && ({
      action: 'ACCOUNT_EMAIL_UPDATED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
      changes: { email: { changed: account.email !== updated.email } },
      metadata: { noOp: account.email === updated.email },
    }));

    if (!updatedAccount) {
      throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }

    await authManager.invalidatePermissionCache(accountId);
    return getAccount(accountId);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
    throw error;
  }
}

async function resetPassword(accountId, password, authContext, httpContext) {
  assertValidObjectId(accountId, 'accountId');
  const passwordPayload = await hashPassword(password);
  const account = await runAdminMutation(authContext, httpContext, (session) => (
    accountRepository.updatePassword(accountId, passwordPayload, { session })
  ), (updated) => updated && ({
    action: 'ACCOUNT_PASSWORD_RESET', entityType: 'AUTH_ACCOUNT', entityId: accountId,
    changes: {},
  }));

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toAccountDto(account);
}

async function revokeAccountSessions(accountId, authContext, httpContext) {
  assertValidObjectId(accountId, 'accountId');
  const account = await runAdminMutation(authContext, httpContext, (session) => (
    accountRepository.revokeActiveSessions(accountId, { session })
  ), (updated) => updated && ({
    action: 'ACCOUNT_SESSIONS_REVOKED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
    changes: {},
  }));

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authManager.invalidatePermissionCache(accountId);

  return {
    revoked: true,
    account: toAccountDto(account),
  };
}

async function archiveAccount(accountId, authContext, httpContext) {
  assertValidObjectId(accountId, 'accountId');
  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await accountRepository.findById(accountId, { session });
    const account = await accountRepository.archive(accountId, { session });
    return { before, account };
  }, ({ before, account }) => account && ({
    action: 'ACCOUNT_ARCHIVED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
    changes: changedFields(before, account, ['status']),
    metadata: { noOp: before?.status === account?.status },
  }));
  const { account } = mutation;

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authManager.invalidatePermissionCache(accountId);
  return toAccountDto(account);
}

async function updateAccountAccess(accountId, { roles, customPermissions }, authContext, httpContext) {
  assertValidObjectId(accountId, 'accountId');
  const roleDocs = await ensureRolesExist(roles);
  await ensurePermissionsExist(customPermissions);
  roleDocs.forEach((role) => assertCanManageSuperAdmin(authContext, role));

  const account = await accountRepository.findById(accountId);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const session = await mongoose.startSession();
  const operationId = crypto.randomUUID();

  try {
    await session.withTransaction(async () => {
      await accessAssignmentRepository.deactivateActiveGlobalByAccount(accountId, { session });
      await accessAssignmentRepository.createMany(
        buildGlobalAssignments(accountId, roles, customPermissions),
        { session },
      );
      await recordAdminAudit({
        action: 'ACCOUNT_ACCESS_UPDATED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
        changes: {
          roleIds: { after: roles.map(String) },
          customPermissionIds: { after: customPermissions.map(String) },
        },
      }, authContext, httpContext, operationId, session);
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

async function createScope(payload, authContext, httpContext) {
  assertValidRegistryScopeType(payload.scopeType);
  assertValidObjectId(payload.scopeId, 'scopeId');

  try {
    const scope = await runAdminMutation(authContext, httpContext, (session) => (
      scopeRegistryRepository.create({
        scopeType: payload.scopeType,
        scopeId: payload.scopeId,
        name: payload.name,
        status: scopeRegistryStatuses.ACTIVE,
      }, { session })
    ), (created) => ({
      action: 'AUTH_SCOPE_CREATED', entityType: 'AUTH_SCOPE', entityId: created._id,
      scopeType: created.scopeType, scopeId: created.scopeId,
      changes: changedFields({}, created, ['name', 'status']),
    }));

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

async function updateScope(
  scopeRegistryId, payload, authContext, httpContext, action = 'AUTH_SCOPE_UPDATED',
) {
  assertValidObjectId(scopeRegistryId, 'scopeRegistryId');
  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await scopeRegistryRepository.findById(scopeRegistryId, { session });
    if (!before) {
      throw new AppError('Scope registry entry not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    if (payload.status === scopeRegistryStatuses.INACTIVE) {
      const usageCount = await accessAssignmentRepository.countActiveByScope(
        before.scopeType, before.scopeId, { session },
      );
      if (usageCount > 0) {
        throw new AppError('Scope is assigned to active access assignments', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
      }
    }
    return { before, scope: await scopeRegistryRepository.update(scopeRegistryId, payload, { session }) };
  }, ({ before, scope }) => ({
    action, entityType: 'AUTH_SCOPE', entityId: scopeRegistryId,
    scopeType: scope.scopeType, scopeId: scope.scopeId,
    changes: changedFields(before, scope, Object.keys(payload)),
    metadata: { noOp: Object.keys(changedFields(before, scope, Object.keys(payload))).length === 0 },
  }));
  const { scope } = mutation;
  return toScopeRegistryDto((await enrichScopesWithMetadata([scope]))[0]);
}

async function deactivateScope(scopeRegistryId, authContext, httpContext) {
  return updateScope(
    scopeRegistryId, { status: scopeRegistryStatuses.INACTIVE }, authContext, httpContext,
    'AUTH_SCOPE_DEACTIVATED',
  );
}

async function getAccessAssignment(assignmentId) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const assignment = await accessAssignmentRepository.findById(assignmentId);

  if (!assignment) {
    throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
}

async function createAccessAssignment(payload, authContext, httpContext) {
  assertValidObjectId(payload.accountId, 'accountId');
  assertValidObjectId(payload.roleId, 'roleId');
  const { scopeType, scopeId } = normalizeScopeInput(payload.scopeType, payload.scopeId);
  const customPermissions = payload.customPermissions || [];
  const overridePermissions = payload.overridePermissions;
  const permissionIdsToValidate = [
    ...customPermissions,
    ...(Array.isArray(overridePermissions) ? overridePermissions : []),
  ];

  const [account, role] = await Promise.all([
    accountRepository.findById(payload.accountId),
    roleRepository.findById(payload.roleId),
    ensurePermissionsExist(permissionIdsToValidate),
  ]);

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  assertCanManageSuperAdmin(authContext, role, scopeType);

  await ensureScopeRegistered(scopeType, scopeId);

  try {
    const assignmentPayload = {
      accountId: payload.accountId,
      roleId: payload.roleId,
      scopeType,
      scopeId,
      customPermissions,
      status: accessAssignmentStatuses.ACTIVE,
    };

    if (overridePermissions !== undefined) {
      assignmentPayload.overridePermissions = overridePermissions;
    }

    const assignment = await runAdminMutation(authContext, httpContext, (session) => (
      accessAssignmentRepository.create(assignmentPayload, { session })
    ), (created) => ({
      action: 'ACCESS_ASSIGNMENT_CREATED', entityType: 'AUTH_ACCESS_ASSIGNMENT', entityId: created._id,
      scopeType: created.scopeType, scopeId: created.scopeId,
      changes: changedFields({}, created, [
        'accountId', 'roleId', 'customPermissions', 'overridePermissions', 'status',
      ]),
    }));

    await authManager.invalidatePermissionCache(payload.accountId);
    return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Access assignment already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function updateAccessAssignment(assignmentId, payload, authContext, httpContext) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const existingAssignment = await accessAssignmentRepository.findById(assignmentId);

  if (!existingAssignment) {
    throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const currentRole = await roleRepository.findById(existingAssignment.roleId);

  if (!currentRole) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  let assignmentRole = currentRole;
  const update = {};

  if (payload.roleId !== undefined) {
    assertValidObjectId(payload.roleId, 'roleId');
    const role = await roleRepository.findById(payload.roleId);

    if (!role) {
      throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }

    assignmentRole = role;
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

  if (payload.overridePermissions !== undefined) {
    if (Array.isArray(payload.overridePermissions)) {
      await ensurePermissionsExist(payload.overridePermissions);
    }

    update.overridePermissions = payload.overridePermissions;
  }

  if (payload.status !== undefined) {
    update.status = payload.status;
  }

  assertCanManageSuperAdmin(
    authContext,
    assignmentRole,
    update.scopeType ?? existingAssignment.scopeType,
  );

  try {
    const assignment = await runAdminMutation(authContext, httpContext, (session) => (
      accessAssignmentRepository.update(assignmentId, update, { session })
    ), (updated) => ({
      action: 'ACCESS_ASSIGNMENT_UPDATED', entityType: 'AUTH_ACCESS_ASSIGNMENT', entityId: assignmentId,
      scopeType: updated.scopeType, scopeId: updated.scopeId,
      changes: changedFields(existingAssignment, updated, Object.keys(update)),
      metadata: {
        noOp: Object.keys(changedFields(existingAssignment, updated, Object.keys(update))).length === 0,
      },
    }));
    await authManager.invalidatePermissionCache(existingAssignment.accountId);
    return toAccessAssignmentDto((await enrichAccessAssignments([assignment]))[0]);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Access assignment already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function deactivateAccessAssignment(assignmentId, authContext, httpContext) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const existingAssignment = await accessAssignmentRepository.findById(assignmentId);

  if (!existingAssignment) {
    throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const role = await roleRepository.findById(existingAssignment.roleId);
  assertCanManageSuperAdmin(authContext, role, existingAssignment.scopeType);

  const assignment = await runAdminMutation(authContext, httpContext, (session) => (
    accessAssignmentRepository.deactivate(assignmentId, { session })
  ), (updated) => ({
    action: 'ACCESS_ASSIGNMENT_DEACTIVATED', entityType: 'AUTH_ACCESS_ASSIGNMENT', entityId: assignmentId,
    scopeType: updated.scopeType, scopeId: updated.scopeId,
    changes: changedFields(existingAssignment, updated, ['status']),
    metadata: { noOp: existingAssignment.status === updated.status },
  }));
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

async function createRole(payload, authContext, httpContext) {
  const code = normalizeUppercase(payload.code);
  const description = normalizeOptionalString(payload.description);
  const existingRole = await roleRepository.findByCode(code);

  if (existingRole) {
    throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  await ensurePermissionsExist(payload.permissions || []);

  try {
    const role = await runAdminMutation(authContext, httpContext, (session) => roleRepository.create({
      name: payload.name,
      code,
      description,
      permissions: payload.permissions || [],
    }, { session }), (created) => ({
      action: 'ROLE_CREATED', entityType: 'AUTH_ROLE', entityId: created._id,
      changes: {
        code: { after: created.code }, name: { after: created.name || null },
        permissionIds: { after: (created.permissions || []).map(String) },
      },
    }));

    return toRoleDto((await enrichRolesWithPermissionDetails([role]))[0]);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function updateRole(roleId, payload, authContext, httpContext) {
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

  const before = await roleRepository.findById(roleId);
  let role;

  try {
    role = await runAdminMutation(authContext, httpContext, (session) => (
      roleRepository.update(roleId, update, { session })
    ), (updated) => updated && ({
      action: 'ROLE_UPDATED', entityType: 'AUTH_ROLE', entityId: roleId,
      changes: changedFields(before, updated, Object.keys(update)),
      metadata: { noOp: Object.keys(changedFields(before, updated, Object.keys(update))).length === 0 },
    }));
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

async function addRolePermission(roleId, permissionId, authContext, httpContext) {
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

  const updatedRole = await runAdminMutation(authContext, httpContext, (session) => (
    roleRepository.addPermission(roleId, permissionId, { session })
  ), (updated) => ({
    action: 'ROLE_PERMISSION_ADDED', entityType: 'AUTH_ROLE', entityId: roleId,
    changes: { permissionIds: { before: (role.permissions || []).map(String), after: (updated.permissions || []).map(String) } },
    metadata: { noOp: (role.permissions || []).some((id) => String(id) === String(permissionId)) },
  }));
  await invalidateAccountsByRole(roleId);

  return toRoleDto((await enrichRolesWithPermissionDetails([updatedRole]))[0]);
}

async function removeRolePermission(roleId, permissionId, authContext, httpContext) {
  assertValidObjectId(roleId, 'roleId');
  assertValidObjectId(permissionId, 'permissionId');

  const role = await roleRepository.findById(roleId);

  if (!role) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const updatedRole = await runAdminMutation(authContext, httpContext, (session) => (
    roleRepository.removePermission(roleId, permissionId, { session })
  ), (updated) => ({
    action: 'ROLE_PERMISSION_REMOVED', entityType: 'AUTH_ROLE', entityId: roleId,
    changes: { permissionIds: { before: (role.permissions || []).map(String), after: (updated.permissions || []).map(String) } },
    metadata: { noOp: !(role.permissions || []).some((id) => String(id) === String(permissionId)) },
  }));
  await invalidateAccountsByRole(roleId);

  return toRoleDto((await enrichRolesWithPermissionDetails([updatedRole]))[0]);
}

async function setScopedRolePermissions(
  { scopeType, scopeId, roleId, permissionIds }, authContext, httpContext,
) {
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

  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await scopedRolePermissionRepository.findByScopeRole(
      normalizedScope.scopeType, normalizedScope.scopeId, roleId, { session },
    );
    const updated = await scopedRolePermissionRepository.upsert({
      scopeType: normalizedScope.scopeType,
      scopeId: normalizedScope.scopeId,
      roleId,
      permissions: permissionIds || [],
    }, { session });
    return { before, updated };
  }, ({ before, updated }) => ({
    action: 'SCOPED_ROLE_PERMISSIONS_SET', entityType: 'AUTH_SCOPED_ROLE_PERMISSION',
    entityId: `${normalizedScope.scopeId}:${roleId}`,
    scopeType: normalizedScope.scopeType, scopeId: normalizedScope.scopeId,
    changes: {
      permissionIds: {
        ...(before ? { before: (before.permissions || []).map(String) } : {}),
        after: (updated.permissions || []).map(String),
      },
    },
    metadata: {
      noOp: Boolean(before) && JSON.stringify((before.permissions || []).map(String))
        === JSON.stringify((updated.permissions || []).map(String)),
    },
  }));
  const rule = mutation.updated;
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

async function deleteRole(roleId, authContext, httpContext) {
  assertValidObjectId(roleId, 'roleId');
  const usageCount = await accessAssignmentRepository.countByRole(roleId);

  if (usageCount > 0) {
    throw new AppError('Role is assigned to accounts', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const role = await runAdminMutation(authContext, httpContext, (session) => (
    roleRepository.deleteById(roleId, { session })
  ), (deleted) => deleted && ({
    action: 'ROLE_DELETED', entityType: 'AUTH_ROLE', entityId: roleId,
    changes: { deleted: { after: true }, code: { before: deleted.code } },
  }));

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

async function createPermission(payload, authContext, httpContext) {
  const code = normalizeUppercase(payload.code);
  const name = normalizeOptionalString(payload.name);
  const description = normalizeOptionalString(payload.description);
  const existingPermission = await permissionRepository.findByCode(code);

  if (existingPermission) {
    throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  try {
    const permission = await runAdminMutation(authContext, httpContext, (session) => (
      permissionRepository.create({ code, name, description }, { session })
    ), (created) => ({
      action: 'PERMISSION_CREATED', entityType: 'AUTH_PERMISSION', entityId: created._id,
      changes: { code: { after: created.code }, name: { after: created.name || null } },
    }));
    return toPermissionDto((await enrichPermissionsWithUsage([permission]))[0]);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function updatePermission(permissionId, payload, authContext, httpContext) {
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

  const before = await permissionRepository.findById(permissionId);
  let permission;

  try {
    permission = await runAdminMutation(authContext, httpContext, (session) => (
      permissionRepository.update(permissionId, update, { session })
    ), (updated) => updated && ({
      action: 'PERMISSION_UPDATED', entityType: 'AUTH_PERMISSION', entityId: permissionId,
      changes: changedFields(before, updated, Object.keys(update)),
      metadata: { noOp: Object.keys(changedFields(before, updated, Object.keys(update))).length === 0 },
    }));
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

async function deletePermission(permissionId, authContext, httpContext) {
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

  const permission = await runAdminMutation(authContext, httpContext, (session) => (
    permissionRepository.deleteById(permissionId, { session })
  ), (deleted) => deleted && ({
    action: 'PERMISSION_DELETED', entityType: 'AUTH_PERMISSION', entityId: permissionId,
    changes: { deleted: { after: true }, code: { before: deleted.code } },
  }));

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
