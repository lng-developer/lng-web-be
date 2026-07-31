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

async function runAdminMutation(authContext, httpContext, mutate, buildEvent, { session: existingSession } = {}) {
  const operationId = crypto.randomUUID();
  const recordBuiltEvents = async (result, session) => {
    const built = buildEvent(result);
    const events = Array.isArray(built) ? built : [built];
    const filteredEvents = events.filter(Boolean);
    for (const [index, event] of filteredEvents.entries()) {
      const eventOperationId = filteredEvents.length > 1 ? `${operationId}:${index}` : operationId;
      await recordAdminAudit(event, authContext, httpContext, eventOperationId, session);
    }
  };
  if (existingSession) {
    const result = await mutate(existingSession);
    await recordBuiltEvents(result, existingSession);
    return result;
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await mutate(session);
      await recordBuiltEvents(result, session);
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

function assertMutableRole(role) {
  if (role?.code === roleCodes.SUPER_ADMIN) {
    throw new AppError(
      'SUPER_ADMIN is a system role and cannot be modified',
      httpStatus.CONFLICT,
      true,
      errorCodes.CONFLICT_ERROR,
    );
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

  const { passwordHash, passwordSalt } = await hashPassword(password);
  const operationId = crypto.randomUUID();
  const session = await mongoose.startSession();

  try {
    let account;

    await session.withTransaction(async () => {
      const roles = await ensureRolesExist(roleIds, { session, touch: true });
      await ensurePermissionsExist(
        [...customPermissionIds, ...overridePermissionIds], { session, touch: true },
      );
      for (const assignment of normalizedAssignments) {
        await ensureScopeRegistered(
          assignment.scopeType, assignment.scopeId, { session, touch: true },
        );
        assertCanManageSuperAdmin(
          authContext,
          roles.find((role) => String(role._id) === String(assignment.roleId)),
          assignment.scopeType,
        );
      }
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

async function createProvisionedAccount({ email, assignments = [], session, authContext, httpContext }) {
  if (!session) {
    throw new AppError('Transaction session is required', httpStatus.INTERNAL_SERVER_ERROR, true, errorCodes.INTERNAL_SERVER_ERROR);
  }

  try {
    return await runAdminMutation(authContext, httpContext, async (activeSession) => {
      const normalizedEmail = normalizeLowercase(email);
      const existingAccount = await accountRepository.findByEmail(normalizedEmail, { session: activeSession });
      if (existingAccount) throw mapCreateAccountDuplicateError();

      const normalizedAssignments = normalizeAccountAssignments(assignments);
      const roleIds = uniqueIds(normalizedAssignments.map((assignment) => assignment.roleId));
      const customPermissionIds = uniqueIds(normalizedAssignments.flatMap((assignment) => assignment.customPermissions));
      const overridePermissionIds = uniqueIds(normalizedAssignments.flatMap((assignment) => (
        Array.isArray(assignment.overridePermissions) ? assignment.overridePermissions : []
      )));
      const roles = await ensureRolesExist(roleIds, { session: activeSession, touch: true });
      await ensurePermissionsExist(
        [...customPermissionIds, ...overridePermissionIds], { session: activeSession, touch: true },
      );
      for (const assignment of normalizedAssignments) {
        await ensureScopeRegistered(assignment.scopeType, assignment.scopeId, { session: activeSession, touch: true });
        assertCanManageSuperAdmin(
          authContext,
          roles.find((role) => String(role._id) === String(assignment.roleId)),
          assignment.scopeType,
        );
      }

      const { passwordHash, passwordSalt } = await hashPassword('123456');
      const account = await accountRepository.create({
        email: normalizedEmail,
        passwordHash,
        passwordSalt,
        mustChangePassword: true,
        sessions: [],
        status: accountStatuses.ACTIVE,
      }, { session: activeSession });
      await accessAssignmentRepository.createMany(
        buildAccessAssignments(account._id, normalizedAssignments),
        { session: activeSession },
      );
      return account;
    }, (account) => ({
      action: 'ACCOUNT_CREATED',
      entityType: 'AUTH_ACCOUNT',
      entityId: account._id,
      changes: {
        status: { after: accountStatuses.ACTIVE },
        assignmentCount: { after: assignments.length },
        mustChangePassword: { after: true },
      },
    }), { session });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw mapCreateAccountDuplicateError(error);
    throw error;
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
    const noOp = before?.status === status;
    const account = noOp ? before : await accountRepository.updateStatus(accountId, status, { session });
    return { before, account, noOp };
  }, ({ before, account, noOp }) => account && ({
    action: 'ACCOUNT_STATUS_UPDATED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
    changes: noOp ? {} : changedFields(before, account, ['status']),
    metadata: { noOp },
  }));
  const { account, noOp } = mutation;

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (!noOp) await authManager.invalidatePermissionCache(accountId);
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
    const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
      const before = await accountRepository.findById(accountId, { session });
      const noOp = before?.email === normalizedEmail;
      const updated = noOp
        ? before
        : await accountRepository.updateEmail(accountId, normalizedEmail, { session });
      return { before, updated, noOp };
    }, ({ before, updated, noOp }) => updated && ({
      action: 'ACCOUNT_EMAIL_UPDATED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
      changes: { email: { changed: !noOp } },
      metadata: { noOp },
    }));
    const { updated: updatedAccount, noOp } = mutation;

    if (!updatedAccount) {
      throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }

    if (!noOp) await authManager.invalidatePermissionCache(accountId);
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
    const noOp = before?.status === accountStatuses.ARCHIVED;
    const account = noOp ? before : await accountRepository.archive(accountId, { session });
    return { before, account, noOp };
  }, ({ before, account, noOp }) => account && ({
    action: 'ACCOUNT_ARCHIVED', entityType: 'AUTH_ACCOUNT', entityId: accountId,
    changes: noOp ? {} : changedFields(before, account, ['status']),
    metadata: { noOp },
  }));
  const { account, noOp } = mutation;

  if (!account) {
    throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (!noOp) await authManager.invalidatePermissionCache(accountId);
  return toAccountDto(account);
}

async function updateAccountAccess(accountId, { roles, customPermissions }, authContext, httpContext) {
  assertValidObjectId(accountId, 'accountId');
  const session = await mongoose.startSession();
  const operationId = crypto.randomUUID();

  try {
    await session.withTransaction(async () => {
      const roleDocs = await ensureRolesExist(roles, { session, touch: true });
      await ensurePermissionsExist(customPermissions, { session, touch: true });
      roleDocs.forEach((role) => assertCanManageSuperAdmin(authContext, role));
      const account = await accountRepository.findById(accountId, { session });
      if (!account) {
        throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
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

async function syncScopeRegistry(payload, authContext, httpContext, { session: existingSession } = {}) {
  assertValidRegistryScopeType(payload.scopeType);
  assertValidObjectId(payload.scopeId, 'scopeId');

  const update = {
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    name: payload.name,
    status: payload.status || scopeRegistryStatuses.ACTIVE,
  };
  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await scopeRegistryRepository.findByScope(
      payload.scopeType, payload.scopeId, { session },
    );
    const scope = await scopeRegistryRepository.upsertByScope(update, { session });
    return { before, scope };
  }, ({ before, scope }) => {
    const changes = changedFields(before || {}, scope, ['name', 'status']);
    return {
      action: 'AUTH_SCOPE_SYNCED', entityType: 'AUTH_SCOPE', entityId: scope._id,
      scopeType: scope.scopeType, scopeId: scope.scopeId, changes,
      metadata: { noOp: Boolean(before) && Object.keys(changes).length === 0 },
    };
  }, { session: existingSession });
  const { scope } = mutation;

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
      if (before.status === scopeRegistryStatuses.ACTIVE) {
        await scopeRegistryRepository.touchActiveByScope(
          before.scopeType, before.scopeId, { session },
        );
      }
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

    const assignment = await runAdminMutation(authContext, httpContext, async (session) => {
      const account = await accountRepository.findById(payload.accountId, { session });
      const role = await roleRepository.touchById(payload.roleId, { session });
      await ensurePermissionsExist(permissionIdsToValidate, { session, touch: true });
      await ensureScopeRegistered(scopeType, scopeId, { session, touch: true });
      if (!account) {
        throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
      if (!role) {
        throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
      assertCanManageSuperAdmin(authContext, role, scopeType);
      return accessAssignmentRepository.create(assignmentPayload, { session });
    }, (created) => ({
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
  if (payload.roleId !== undefined) assertValidObjectId(payload.roleId, 'roleId');

  try {
    const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
      const before = await accessAssignmentRepository.findById(assignmentId, { session });
      if (!before) {
        throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
      const update = {};
      if (payload.roleId !== undefined) update.roleId = payload.roleId;
      if (payload.scopeType !== undefined || payload.scopeId !== undefined) {
        const normalizedScope = normalizeScopeInput(
          payload.scopeType || before.scopeType,
          payload.scopeId !== undefined ? payload.scopeId : before.scopeId,
        );
        update.scopeType = normalizedScope.scopeType;
        update.scopeId = normalizedScope.scopeId;
      }
      if (payload.customPermissions !== undefined) update.customPermissions = payload.customPermissions;
      if (payload.overridePermissions !== undefined) update.overridePermissions = payload.overridePermissions;
      if (payload.status !== undefined) update.status = payload.status;

      const nextRoleId = update.roleId || before.roleId;
      const nextScopeType = update.scopeType || before.scopeType;
      const nextScopeId = update.scopeId !== undefined ? update.scopeId : before.scopeId;
      const nextStatus = update.status || before.status;
      const nextCustomPermissions = update.customPermissions !== undefined
        ? update.customPermissions : (before.customPermissions || []);
      const nextOverridePermissions = update.overridePermissions !== undefined
        ? update.overridePermissions : before.overridePermissions;
      const permissionIds = [
        ...nextCustomPermissions,
        ...(Array.isArray(nextOverridePermissions) ? nextOverridePermissions : []),
      ];
      const role = await roleRepository.touchById(nextRoleId, { session });
      if (!role) {
        throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
      await ensurePermissionsExist(permissionIds, { session, touch: true });
      if (nextStatus === accessAssignmentStatuses.ACTIVE) {
        await ensureScopeRegistered(nextScopeType, nextScopeId, { session, touch: true });
      }
      assertCanManageSuperAdmin(authContext, role, nextScopeType);

      const proposedChanges = changedFields(before, { ...before, ...update }, Object.keys(update));
      const updated = Object.keys(proposedChanges).length === 0
        ? before
        : await accessAssignmentRepository.update(assignmentId, update, { session });
      const changes = changedFields(before, updated, Object.keys(update));
      return {
        before, updated, changes, noOp: Object.keys(changes).length === 0,
        scopeMoved: before.scopeType !== updated.scopeType || String(before.scopeId) !== String(updated.scopeId),
      };
    }, ({ before, updated, changes, noOp, scopeMoved }) => {
      const base = {
        entityType: 'AUTH_ACCESS_ASSIGNMENT', entityId: assignmentId, changes, metadata: { noOp },
      };
      if (scopeMoved) {
        return [
          { ...base, action: 'ACCESS_ASSIGNMENT_SCOPE_MOVED_FROM', scopeType: before.scopeType, scopeId: before.scopeId },
          { ...base, action: 'ACCESS_ASSIGNMENT_SCOPE_MOVED_TO', scopeType: updated.scopeType, scopeId: updated.scopeId },
        ];
      }
      return { ...base, action: 'ACCESS_ASSIGNMENT_UPDATED', scopeType: updated.scopeType, scopeId: updated.scopeId };
    });
    if (!mutation.noOp) await authManager.invalidatePermissionCache(mutation.before.accountId);
    return toAccessAssignmentDto((await enrichAccessAssignments([mutation.updated]))[0]);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Access assignment already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function deactivateAccessAssignment(assignmentId, authContext, httpContext) {
  assertValidObjectId(assignmentId, 'assignmentId');
  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await accessAssignmentRepository.findById(assignmentId, { session });
    if (!before) {
      throw new AppError('Access assignment not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    const role = await roleRepository.findById(before.roleId, { session });
    assertCanManageSuperAdmin(authContext, role, before.scopeType);
    const noOp = before.status === accessAssignmentStatuses.INACTIVE;
    const updated = noOp ? before : await accessAssignmentRepository.deactivate(assignmentId, { session });
    return { before, updated, noOp };
  }, ({ before, updated, noOp }) => ({
    action: 'ACCESS_ASSIGNMENT_DEACTIVATED', entityType: 'AUTH_ACCESS_ASSIGNMENT', entityId: assignmentId,
    scopeType: updated.scopeType, scopeId: updated.scopeId,
    changes: noOp ? {} : changedFields(before, updated, ['status']),
    metadata: { noOp },
  }));
  if (!mutation.noOp) await authManager.invalidatePermissionCache(mutation.before.accountId);

  return toAccessAssignmentDto((await enrichAccessAssignments([mutation.updated]))[0]);
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

async function listAssignableRoles(authContext = {}) {
  const roles = await roleRepository.listAssignable();
  return isSuperAdmin(authContext)
    ? roles
    : roles.filter((role) => role.code !== roleCodes.SUPER_ADMIN);
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

  try {
    const role = await runAdminMutation(authContext, httpContext, async (session) => {
      await ensurePermissionsExist(payload.permissions || [], { session, touch: true });
      return roleRepository.create({
        name: payload.name,
        code,
        description,
        permissions: payload.permissions || [],
      }, { session });
    }, (created) => ({
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

  if (payload.permissions !== undefined) update.permissions = payload.permissions;
  let mutation;

  try {
    mutation = await runAdminMutation(authContext, httpContext, async (session) => {
      const before = await roleRepository.findById(roleId, { session });
      if (!before) return { before, updated: null, changes: {}, noOp: false };
      assertMutableRole(before);
      if (update.permissions) {
        await ensurePermissionsExist(update.permissions, { session, touch: true });
      }
      const planned = changedFields(before, { ...before, ...update }, Object.keys(update));
      const updated = Object.keys(planned).length === 0
        ? before : await roleRepository.update(roleId, update, { session });
      const changes = changedFields(before, updated, Object.keys(update));
      return { before, updated, changes, noOp: Object.keys(changes).length === 0 };
    }, ({ updated, changes, noOp }) => updated && ({
      action: 'ROLE_UPDATED', entityType: 'AUTH_ROLE', entityId: roleId,
      changes, metadata: { noOp },
    }));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Role code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }

  if (!mutation.updated) {
    throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await invalidateAccountsByRole(roleId);

  return toRoleDto((await enrichRolesWithPermissionDetails([mutation.updated]))[0]);
}

async function addRolePermission(roleId, permissionId, authContext, httpContext) {
  assertValidObjectId(roleId, 'roleId');
  assertValidObjectId(permissionId, 'permissionId');

  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await roleRepository.findById(roleId, { session });
    const permission = await permissionRepository.touchById(permissionId, { session });
    if (!before) {
      throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    assertMutableRole(before);
    if (!permission) {
      throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    const updated = await roleRepository.addPermission(roleId, permissionId, { session });
    const changes = changedFields(before, updated, ['permissions']);
    return { before, updated, changes, noOp: Object.keys(changes).length === 0 };
  }, ({ before, updated, noOp }) => ({
    action: 'ROLE_PERMISSION_ADDED', entityType: 'AUTH_ROLE', entityId: roleId,
    changes: { permissionIds: { before: (before.permissions || []).map(String), after: (updated.permissions || []).map(String) } },
    metadata: { noOp },
  }));
  await invalidateAccountsByRole(roleId);

  return toRoleDto((await enrichRolesWithPermissionDetails([mutation.updated]))[0]);
}

async function removeRolePermission(roleId, permissionId, authContext, httpContext) {
  assertValidObjectId(roleId, 'roleId');
  assertValidObjectId(permissionId, 'permissionId');

  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const before = await roleRepository.findById(roleId, { session });
    if (!before) {
      throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    assertMutableRole(before);
    const updated = await roleRepository.removePermission(roleId, permissionId, { session });
    const changes = changedFields(before, updated, ['permissions']);
    return { before, updated, noOp: Object.keys(changes).length === 0 };
  }, ({ before, updated, noOp }) => ({
    action: 'ROLE_PERMISSION_REMOVED', entityType: 'AUTH_ROLE', entityId: roleId,
    changes: { permissionIds: { before: (before.permissions || []).map(String), after: (updated.permissions || []).map(String) } },
    metadata: { noOp },
  }));
  await invalidateAccountsByRole(roleId);

  return toRoleDto((await enrichRolesWithPermissionDetails([mutation.updated]))[0]);
}

async function setScopedRolePermissions(
  { scopeType, scopeId, roleId, permissionIds }, authContext, httpContext,
) {
  assertValidObjectId(roleId, 'roleId');
  assertValidRegistryScopeType(scopeType);
  const normalizedScope = normalizeScopeInput(scopeType, scopeId);

  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const role = await roleRepository.touchById(roleId, { session });
    if (!role) {
      throw new AppError('Role not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    await ensureScopeRegistered(
      normalizedScope.scopeType, normalizedScope.scopeId, { session, touch: true },
    );
    await ensurePermissionsExist(permissionIds || [], { session, touch: true });
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

function teamAssignmentEvent(action, assignment) {
  if (!assignment) return null;
  const active = action === 'ACCESS_ASSIGNMENT_CREATED';
  return {
    action,
    entityType: 'AUTH_ACCESS_ASSIGNMENT',
    entityId: assignment._id || assignment.id,
    scopeType: accessScopeTypes.TEAM,
    scopeId: assignment.scopeId,
    changes: {
      status: active
        ? { after: accessAssignmentStatuses.ACTIVE }
        : { before: accessAssignmentStatuses.ACTIVE, after: accessAssignmentStatuses.INACTIVE },
      roleId: active
        ? { after: String(assignment.roleId) }
        : { before: String(assignment.roleId) },
    },
    metadata: { accountId: String(assignment.accountId) },
  };
}

async function ensureTeamRoleAssignment(accountId, teamId, desiredRoleCode, replacedRoleCode, options = {}) {
  assertValidObjectId(accountId, 'accountId');
  assertValidObjectId(teamId, 'teamId');
  const { authContext, httpContext } = options;

  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const account = await accountRepository.findById(accountId, { session });
    const desiredRole = await ensureRoleByCode(desiredRoleCode, { session, touch: true });
    const replacedRole = await ensureRoleByCode(replacedRoleCode, { session, touch: true });
    await ensureScopeRegistered(accessScopeTypes.TEAM, teamId, { session, touch: true });
    if (!account) {
      throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    const activeDesired = await accessAssignmentRepository.findActiveByAccountRoleScope(
      accountId, desiredRole._id, accessScopeTypes.TEAM, teamId, { session },
    );
    const activeReplaced = await accessAssignmentRepository.findActiveByAccountRoleScope(
      accountId, replacedRole._id, accessScopeTypes.TEAM, teamId, { session },
    );
    const assignment = activeDesired || await accessAssignmentRepository.upsertActiveScopedRole({
      accountId,
      roleId: desiredRole._id,
      scopeType: accessScopeTypes.TEAM,
      scopeId: teamId,
      customPermissions: [],
      status: accessAssignmentStatuses.ACTIVE,
    }, { session });
    if (activeReplaced) {
      await accessAssignmentRepository.deactivateActiveByAccountRoleScope(
        accountId, replacedRole._id, accessScopeTypes.TEAM, teamId, { session },
      );
    }
    return { assignment, created: activeDesired ? null : assignment, deactivated: activeReplaced };
  }, ({ created, deactivated }) => [
    teamAssignmentEvent('ACCESS_ASSIGNMENT_CREATED', created),
    teamAssignmentEvent('ACCESS_ASSIGNMENT_DEACTIVATED', deactivated),
  ], options);
  if (mutation.created || mutation.deactivated) await authManager.invalidatePermissionCache(accountId);

  return toAccessAssignmentDto((await enrichAccessAssignments([mutation.assignment]))[0]);
}

async function ensureTeamLeaderAssignment(accountId, teamId, options = {}) {
  return ensureTeamRoleAssignment(accountId, teamId, roleCodes.LEADER, roleCodes.USER, options);
}

async function ensureTeamMemberAssignment(accountId, teamId, options = {}) {
  return ensureTeamRoleAssignment(accountId, teamId, roleCodes.USER, roleCodes.LEADER, options);
}

async function deactivateTeamRoleAssignments(accountId, teamId, options = {}) {
  assertValidObjectId(accountId, 'accountId');
  assertValidObjectId(teamId, 'teamId');
  const { authContext, httpContext } = options;
  const mutation = await runAdminMutation(authContext, httpContext, async (session) => {
    const roles = [
      await ensureRoleByCode(roleCodes.LEADER, { session, touch: true }),
      await ensureRoleByCode(roleCodes.USER, { session, touch: true }),
    ];
    const activeAssignments = [];
    for (const role of roles) {
      const assignment = await accessAssignmentRepository.findActiveByAccountRoleScope(
        accountId, role._id, accessScopeTypes.TEAM, teamId, { session },
      );
      if (assignment) activeAssignments.push(assignment);
    }
    for (const assignment of activeAssignments) {
      await accessAssignmentRepository.deactivateActiveByAccountRoleScope(
        accountId, assignment.roleId, accessScopeTypes.TEAM, teamId, { session },
      );
    }
    return activeAssignments;
  }, (assignments) => assignments.map((assignment) => (
    teamAssignmentEvent('ACCESS_ASSIGNMENT_DEACTIVATED', assignment)
  )), options);
  if (mutation.length) await authManager.invalidatePermissionCache(accountId);

  return { deactivated: mutation.length > 0 };
}

async function deleteRole(roleId, authContext, httpContext) {
  assertValidObjectId(roleId, 'roleId');
  const role = await runAdminMutation(authContext, httpContext, async (session) => {
    const current = await roleRepository.touchById(roleId, { session });
    if (!current) return null;
    assertMutableRole(current);
    const assignmentUsageCount = await accessAssignmentRepository.countByRole(roleId, { session });
    const scopedUsageCount = await scopedRolePermissionRepository.countByRole(roleId, { session });
    if (assignmentUsageCount > 0 || scopedUsageCount > 0) {
      throw new AppError('Role is assigned to accounts', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
    return roleRepository.deleteById(roleId, { session });
  }, (deleted) => deleted && ({
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

  let mutation;

  try {
    mutation = await runAdminMutation(authContext, httpContext, async (session) => {
      const before = await permissionRepository.findById(permissionId, { session });
      if (!before) return { before, updated: null, changes: {}, noOp: false };
      const planned = changedFields(before, { ...before, ...update }, Object.keys(update));
      const updated = Object.keys(planned).length === 0
        ? before : await permissionRepository.update(permissionId, update, { session });
      const changes = changedFields(before, updated, Object.keys(update));
      return { before, updated, changes, noOp: Object.keys(changes).length === 0 };
    }, ({ updated, changes, noOp }) => updated && ({
      action: 'PERMISSION_UPDATED', entityType: 'AUTH_PERMISSION', entityId: permissionId,
      changes, metadata: { noOp },
    }));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Permission code is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }

  if (!mutation.updated) {
    throw new AppError('Permission not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const affectedAccounts = await findAccountsAffectedByPermission(permissionId);
  await invalidateAccounts(affectedAccounts);

  return toPermissionDto((await enrichPermissionsWithUsage([mutation.updated]))[0]);
}

async function deletePermission(permissionId, authContext, httpContext) {
  assertValidObjectId(permissionId, 'permissionId');
  const permission = await runAdminMutation(authContext, httpContext, async (session) => {
    const current = await permissionRepository.touchById(permissionId, { session });
    if (!current) return null;
    const customUsageCount = await accessAssignmentRepository.countByCustomPermission(
      permissionId, { session },
    );
    const roleUsageCount = await roleRepository.countByPermission(permissionId, { session });
    const scopedRoleUsageCount = await scopedRolePermissionRepository.countByPermission(
      permissionId, { session },
    );
    if (customUsageCount > 0) {
      throw new AppError('Permission is assigned directly to accounts', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
    if (roleUsageCount > 0 || scopedRoleUsageCount > 0) {
      throw new AppError('Permission is assigned to roles or scoped role rules', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
    return permissionRepository.deleteById(permissionId, { session });
  }, (deleted) => deleted && ({
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
  createProvisionedAccount,
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
  listAssignableRoles,
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
