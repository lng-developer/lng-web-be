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

async function syncDepartmentScope(department) {
  await authPublic.syncScopeRegistry({
    scopeType: 'department',
    scopeId: department._id || department.id,
    name: department.name,
    status: department.status,
  });
}

async function syncTeamScope(team) {
  await authPublic.syncScopeRegistry({
    scopeType: 'team',
    scopeId: team._id || team.id,
    name: team.name,
    status: team.status,
  });
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
  if (payload.accountId) {
    return payload.accountId;
  }

  const profile = await authPublic.findProfileByEmployeeCode(payload.employeeCode);

  if (!profile) {
    throw new AppError('Employee not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return profile.accountId;
}

function assertCanManageTeam(team, actorAuth) {
  if (!actorAuth) {
    return;
  }

  const allowed = authPublic.canAccessScope(
    actorAuth,
    'TEAMS:WRITE',
    { scopeType: 'department', scopeId: team.departmentId },
  );

  if (!allowed) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

async function syncTeamAccessAssignment(accountId, teamId, memberType, { session } = {}) {
  if (memberType === teamMemberTypes.LEADER) {
    await authPublic.ensureTeamLeaderAssignment(accountId, teamId, { session });
    return;
  }

  await authPublic.ensureTeamMemberAssignment(accountId, teamId, { session });
}

async function listDepartments(query = {}) {
  const result = await departmentRepository.list(query);
  return toPaginatedResponse(result, toDepartmentDto);
}

async function createDepartment(payload) {
  try {
    const department = await departmentRepository.create({
      name: payload.name,
      code: normalizeCode(payload.code),
      status: organizationStatuses.ACTIVE,
    });

    await syncDepartmentScope(department);
    return toDepartmentDto(department);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Department code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function getDepartment(departmentId) {
  assertValidObjectId(departmentId, 'departmentId');
  const department = await departmentRepository.findById(departmentId);

  if (!department) {
    throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  return toDepartmentDto(department);
}

async function updateDepartment(departmentId, payload) {
  assertValidObjectId(departmentId, 'departmentId');
  const update = { ...payload };

  if (update.code) {
    update.code = normalizeCode(update.code);
  }

  try {
    const department = await departmentRepository.update(departmentId, update);

    if (!department) {
      throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }

    await syncDepartmentScope(department);
    return toDepartmentDto(department);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Department code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function listTeams(query = {}) {
  if (query.departmentId) {
    assertValidObjectId(query.departmentId, 'departmentId');
  }

  const result = await teamRepository.list(query);
  return toPaginatedResponse(result, toTeamDto);
}

async function listMemberCandidates(query = {}) {
  const activeAccountIds = await teamMembershipRepository.listActiveAccountIds();

  return authPublic.listAssignableProfiles({
    excludedAccountIds: activeAccountIds,
    search: query.search,
    limit: query.limit || 50,
  });
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
    const team = await teamRepository.create({
      name: payload.name,
      code: normalizeCode(payload.code),
      departmentId: payload.departmentId,
      status: organizationStatuses.ACTIVE,
    });

    await syncTeamScope(team);
    return toTeamDto(team);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Team code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  }
}

async function getTeam(teamId) {
  assertValidObjectId(teamId, 'teamId');
  const team = await teamRepository.findById(teamId);

  if (!team) {
    throw new AppError('Team not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
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
    const team = await teamRepository.update(teamId, update);

    if (!team) {
      throw new AppError('Team not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }

    await syncTeamScope(team);
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
  assertCanManageTeam(team, actorAuth);
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
  assertCanManageTeam(team, actorAuth);
  assertValidObjectId(accountId, 'accountId');

  const membership = await teamMembershipRepository.deactivate(teamId, accountId);

  if (!membership) {
    throw new AppError('Team membership not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await authPublic.deactivateTeamRoleAssignments(accountId, teamId);

  return { removed: true };
}

async function listTeamMembers(teamId) {
  const team = await assertActiveTeam(teamId);
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

module.exports = {
  listDepartments,
  createDepartment,
  getDepartment,
  updateDepartment,
  listTeams,
  listMemberCandidates,
  listAccountOrganizationSummaries,
  createTeam,
  getTeam,
  updateTeam,
  addTeamMember,
  removeTeamMember,
  listTeamMembers,
  listTeamsByDepartment,
};
