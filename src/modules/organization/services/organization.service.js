const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../auth/public');
const departmentRepository = require('../repositories/department.repository');
const teamRepository = require('../repositories/team.repository');
const teamMembershipRepository = require('../repositories/teamMembership.repository');
const {
  organizationStatuses,
  teamMemberTypes,
} = require('../constants');
const {
  toDepartmentDto,
  toTeamDto,
  toTeamMemberDto,
  toAccountOrganizationDto,
  toPaginatedResponse,
} = require('../dtos/organization.dto');

function assertValidObjectId(value, fieldName) {
  if (!mongoose.isValidObjectId(value)) {
    throw new AppError(`${fieldName} is invalid`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

function isDuplicateKeyError(error) {
  return error && error.code === 11000;
}

function normalizeCode(code) {
  return String(code).trim().toUpperCase();
}

async function syncDepartmentScope(department, { session } = {}) {
  await authPublic.syncScopeRegistry({
    scopeType: 'department',
    scopeId: department._id || department.id,
    name: department.name,
    status: department.status,
  }, undefined, undefined, { session });
}

async function syncTeamScope(team, { session } = {}) {
  await authPublic.syncScopeRegistry({
    scopeType: 'team',
    scopeId: team._id || team.id,
    name: team.name,
    status: team.status,
  }, undefined, undefined, { session });
}

async function runScopeSourceMutation(mutate, syncScope) {
  const session = await mongoose.startSession();
  try {
    let entity;
    await session.withTransaction(async () => {
      entity = await mutate(session);
      await syncScope(entity, { session });
    });
    return entity;
  } finally {
    await session.endSession();
  }
}

async function assertActiveDepartment(departmentId) {
  assertValidObjectId(departmentId, 'departmentId');
  const department = await departmentRepository.findById(departmentId);

  if (!department || department.status !== organizationStatuses.ACTIVE) {
    throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return department;
}

async function assertActiveTeam(teamId) {
  assertValidObjectId(teamId, 'teamId');
  const team = await teamRepository.findById(teamId);

  if (!team || team.status !== organizationStatuses.ACTIVE) {
    throw new AppError('Team not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return team;
}

async function assertActiveAccount(accountId) {
  assertValidObjectId(accountId, 'accountId');

  try {
    return await authPublic.getCurrentAccount(accountId);
  } catch (error) {
    if (error && error.code === errorCodes.AUTHENTICATION_ERROR) {
      throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }

    throw error;
  }
}

async function resolveAccountId(payload) {
  return payload.accountId;
}

function assertCanManageTeam(team, actorAuth, memberType) {
  if (!actorAuth) {
    return;
  }

  const canManageDepartment = authPublic.canAccessScope(
    actorAuth,
    'TEAMS:WRITE',
    { scopeType: 'department', scopeId: team.departmentId },
  );

  if (canManageDepartment) {
    return;
  }

  const canManageTeamStaff = memberType === teamMemberTypes.MEMBER && authPublic.canAccessScope(
    actorAuth,
    'TEAMS:WRITE',
    { scopeType: 'team', scopeId: team._id || team.id },
  );

  if (canManageTeamStaff) {
    return;
  }

  throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalPermission(actorAuth, permission) {
  return (actorAuth?.permissions || []).includes(permission);
}

function hasAnyGlobalPermission(actorAuth, permissions) {
  return permissions.some((permission) => hasGlobalPermission(actorAuth, permission));
}

function canAccessAnyScopePermission(actorAuth, permissions, scope) {
  return permissions.some((permission) => authPublic.canAccessScope(actorAuth, permission, scope));
}

function getScopeIds(actorAuth, scopeType, permissions) {
  if (!actorAuth) {
    return null;
  }

  if (hasAnyGlobalPermission(actorAuth, permissions)) {
    return null;
  }

  return (actorAuth?.scopes || [])
    .filter((scope) => (
      scope.scopeType === scopeType
      && permissions.some((permission) => (scope.permissions || []).includes(permission))
    ))
    .map((scope) => String(scope.scopeId))
    .filter(Boolean);
}

const ORGANIZATION_READ_PERMISSIONS = ['AUTH:READ', 'AUTH:WRITE', 'TEAMS:READ', 'TEAMS:WRITE'];
const TEAM_SCOPE_READ_PERMISSIONS = ['TEAMS:READ', 'TEAMS:WRITE'];

async function syncTeamAccessAssignment(accountId, teamId, memberType, { session } = {}) {
  if (memberType === teamMemberTypes.LEADER) {
    await authPublic.ensureTeamLeaderAssignment(accountId, teamId, { session });
    return;
  }

  await authPublic.ensureTeamMemberAssignment(accountId, teamId, { session });
}

async function listDepartments(query = {}, { actorAuth } = {}) {
  const departmentIds = getScopeIds(actorAuth, 'department', ORGANIZATION_READ_PERMISSIONS);

  if (departmentIds && departmentIds.length === 0) {
    return toPaginatedResponse({
      items: [],
      pagination: { page: 1, limit: query.limit || 20, total: 0, totalPages: 0 },
    }, toDepartmentDto);
  }

  const result = await departmentRepository.list({
    ...query,
    ...(departmentIds ? { ids: departmentIds } : {}),
  });
  return toPaginatedResponse(result, toDepartmentDto);
}

async function createDepartment(payload) {
  try {
    const department = await runScopeSourceMutation((session) => departmentRepository.create({
      name: payload.name,
      code: normalizeCode(payload.code),
      status: organizationStatuses.ACTIVE,
    }, { session }), syncDepartmentScope);
    return toDepartmentDto(department);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Department code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function getDepartment(departmentId, { actorAuth } = {}) {
  assertValidObjectId(departmentId, 'departmentId');
  const department = await departmentRepository.findById(departmentId);

  if (!department) {
    throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const canRead = !actorAuth || hasAnyGlobalPermission(actorAuth, ORGANIZATION_READ_PERMISSIONS)
    || canAccessAnyScopePermission(actorAuth, TEAM_SCOPE_READ_PERMISSIONS, {
      scopeType: 'department',
      scopeId: department._id || department.id,
    });

  if (!canRead) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }

  return toDepartmentDto(department);
}

async function getTeamByCode(code) {
  const team = await teamRepository.findByCode(code);
  if (!team || team.status !== organizationStatuses.ACTIVE) return null;
  return toTeamDto(team);
}

async function updateDepartment(departmentId, payload) {
  assertValidObjectId(departmentId, 'departmentId');
  const update = { ...payload };

  if (update.code) {
    update.code = normalizeCode(update.code);
  }

  try {
    const department = await runScopeSourceMutation(async (session) => {
      const updated = await departmentRepository.update(departmentId, update, { session });
      if (!updated) {
        throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
      return updated;
    }, syncDepartmentScope);
    return toDepartmentDto(department);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Department code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function listTeams(query = {}, { actorAuth } = {}) {
  if (query.departmentId) {
    assertValidObjectId(query.departmentId, 'departmentId');
  }

  const teamIds = getScopeIds(actorAuth, 'team', ORGANIZATION_READ_PERMISSIONS);
  const departmentIds = getScopeIds(actorAuth, 'department', ORGANIZATION_READ_PERMISSIONS);

  if (
    (teamIds && teamIds.length === 0)
    && (departmentIds && departmentIds.length === 0)
  ) {
    return toPaginatedResponse({
      items: [],
      pagination: { page: 1, limit: query.limit || 20, total: 0, totalPages: 0 },
    }, toTeamDto);
  }

  if (teamIds && teamIds.length > 0) {
    query.ids = teamIds;
  }

  if (departmentIds && departmentIds.length > 0) {
    query.departmentIds = departmentIds;
  }

  const result = await teamRepository.list({
    ...query,
  });
  return toPaginatedResponse(result, toTeamDto);
}

async function listAccountOrganizationSummaries(accountIds = []) {
  const uniqueAccountIds = [...new Set(accountIds.map((accountId) => String(accountId)))];

  uniqueAccountIds.forEach((accountId) => {
    assertValidObjectId(accountId, 'accountId');
  });

  const organizations = await teamMembershipRepository.listActiveOrganizationByAccountIds(uniqueAccountIds);
  return organizations.map(toAccountOrganizationDto);
}

async function createTeam(payload) {
  await assertActiveDepartment(payload.departmentId);

  try {
    const team = await runScopeSourceMutation((session) => teamRepository.create({
      name: payload.name,
      code: normalizeCode(payload.code),
      departmentId: payload.departmentId,
      status: organizationStatuses.ACTIVE,
    }, { session }), syncTeamScope);
    return toTeamDto(team);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Team code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function getTeam(teamId, { actorAuth } = {}) {
  assertValidObjectId(teamId, 'teamId');
  const team = await teamRepository.findById(teamId);

  if (!team) {
    throw new AppError('Team not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const canRead = !actorAuth || hasAnyGlobalPermission(actorAuth, ORGANIZATION_READ_PERMISSIONS)
    || canAccessAnyScopePermission(actorAuth, TEAM_SCOPE_READ_PERMISSIONS, {
      scopeType: 'team',
      scopeId: team._id || team.id,
    })
    || canAccessAnyScopePermission(actorAuth, TEAM_SCOPE_READ_PERMISSIONS, {
      scopeType: 'department',
      scopeId: team.departmentId,
    });

  if (!canRead) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }

  return toTeamDto(team);
}

async function updateTeam(teamId, payload) {
  assertValidObjectId(teamId, 'teamId');
  const update = { ...payload };

  if (update.departmentId) {
    await assertActiveDepartment(update.departmentId);
  }

  if (update.code) {
    update.code = normalizeCode(update.code);
  }

  try {
    const team = await runScopeSourceMutation(async (session) => {
      const updated = await teamRepository.update(teamId, update, { session });
      if (!updated) {
        throw new AppError('Team not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
      }
      return updated;
    }, syncTeamScope);
    return toTeamDto(team);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Team code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function addTeamMember(teamId, payload, { actorAuth } = {}) {
  const accountId = await resolveAccountId(payload);
  const [team, authModel] = await Promise.all([
    assertActiveTeam(teamId),
    assertActiveAccount(accountId),
  ]);
  assertCanManageTeam(team, actorAuth, payload.memberType);
  const session = await mongoose.startSession();

  try {
    let membership;
    let moved = false;

    await session.withTransaction(async () => {
      const existingMembership = await teamMembershipRepository.findActiveByAccountId(accountId, { session });
      const existingTeamId = existingMembership ? String(existingMembership.teamId) : null;
      const nextTeamId = String(team._id);

      if (existingMembership && existingTeamId !== nextTeamId) {
        moved = true;
        await teamMembershipRepository.deactivateActiveByAccountId(accountId, { session });
        await authPublic.deactivateTeamRoleAssignments(accountId, existingTeamId, { session });
      }

      membership = await teamMembershipRepository.upsertActive({
        accountId,
        teamId: team._id,
        memberType: payload.memberType,
      }, { session });
      await syncTeamAccessAssignment(accountId, team._id, payload.memberType, { session });
    });

    return {
      ...toTeamMemberDto(membership, authModel),
      moved,
    };
  } finally {
    await session.endSession();
  }
}

async function removeTeamMember(teamId, accountId, { actorAuth } = {}) {
  const team = await assertActiveTeam(teamId);
  assertValidObjectId(accountId, 'accountId');
  const existingMembership = await teamMembershipRepository.findActiveByTeamAndAccount(teamId, accountId);

  if (!existingMembership) {
    throw new AppError('Team membership not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  assertCanManageTeam(team, actorAuth, existingMembership.memberType);

  const membership = await teamMembershipRepository.deactivate(teamId, accountId);

  if (!membership) {
    throw new AppError('Team membership not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authPublic.deactivateTeamRoleAssignments(accountId, teamId);

  return { removed: true };
}

async function listTeamMembers(teamId, { actorAuth } = {}) {
  const team = await assertActiveTeam(teamId);
  const canRead = !actorAuth || hasAnyGlobalPermission(actorAuth, ORGANIZATION_READ_PERMISSIONS)
    || canAccessAnyScopePermission(
      actorAuth,
      TEAM_SCOPE_READ_PERMISSIONS,
      { scopeType: 'team', scopeId: team._id || team.id },
    ) || canAccessAnyScopePermission(
      actorAuth,
      TEAM_SCOPE_READ_PERMISSIONS,
      { scopeType: 'department', scopeId: team.departmentId },
    );

  if (!canRead) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }

  const memberships = await teamMembershipRepository.listActiveByTeam(team._id);
  const members = await Promise.all(
    memberships.map(async (membership) => {
      const authModel = await assertActiveAccount(membership.accountId);
      return toTeamMemberDto(membership, authModel);
    }),
  );

  return {
    team: toTeamDto(team),
    leaders: members.filter((member) => member.memberType === teamMemberTypes.LEADER),
    members: members.filter((member) => member.memberType === teamMemberTypes.MEMBER),
  };
}

async function listTeamsByDepartment(departmentId) {
  await assertActiveDepartment(departmentId);
  const result = await teamRepository.list({
    departmentId,
    status: organizationStatuses.ACTIVE,
    page: 1,
    limit: 100,
  });

  return result.items.map(toTeamDto);
}

async function migrateLegacyDepartments(items, options) {
  const result = await departmentRepository.migrateLegacyDepartments(items, options);
  if (options?.apply) await Promise.all(items.map(syncDepartmentScope));
  return result;
}

async function resolveLegacyDepartments(items) {
  return departmentRepository.resolveLegacyDepartments(items);
}

async function migrateLegacyTeams(items, options) {
  const result = await teamRepository.migrateLegacyTeams(items, options);
  if (options?.apply) await Promise.all(items.map(syncTeamScope));
  return result;
}

async function resolveLegacyTeams(items) {
  return teamRepository.resolveLegacyTeams(items);
}

async function migrateLegacyMemberships(items, options) {
  return teamMembershipRepository.migrateLegacyMemberships(items, options);
}

module.exports = {
  listDepartments,
  createDepartment,
  getDepartment,
  getTeamByCode,
  updateDepartment,
  listTeams,
  listAccountOrganizationSummaries,
  createTeam,
  getTeam,
  updateTeam,
  addTeamMember,
  removeTeamMember,
  listTeamMembers,
  listTeamsByDepartment,
  migrateLegacyDepartments,
  resolveLegacyDepartments,
  migrateLegacyTeams,
  resolveLegacyTeams,
  migrateLegacyMemberships,
};
