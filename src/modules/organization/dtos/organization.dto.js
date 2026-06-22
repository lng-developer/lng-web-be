function toDepartmentDto(department) {
  if (!department) {
    return null;
  }

  return {
    id: String(department._id || department.id),
    name: department.name,
    code: department.code,
    status: department.status,
    createdAt: department.createdAt,
    updatedAt: department.updatedAt,
  };
}

function toTeamDto(team) {
  if (!team) {
    return null;
  }

  return {
    id: String(team._id || team.id),
    name: team.name,
    code: team.code,
    departmentId: String(team.departmentId),
    status: team.status,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

function toTeamMemberDto(membership, authModel = {}) {
  const profile = authModel.profile || {};
  const account = authModel.account || {};

  return {
    accountId: String(membership.accountId),
    profileId: profile._id ? String(profile._id) : null,
    employeeCode: profile.employeeCode || null,
    fullName: profile.fullName || null,
    email: account.email || profile.email || null,
    memberType: membership.memberType,
    roles: authModel.roles || [],
    permissions: authModel.permissions || [],
  };
}

function toAccountOrganizationDto(organization = {}) {
  const team = organization.team || null;
  const department = organization.department || null;

  return {
    accountId: String(organization.accountId),
    memberType: organization.memberType || null,
    team: team && team.id ? {
      id: String(team.id),
      name: team.name,
      code: team.code,
      status: team.status,
    } : null,
    department: department && department.id ? {
      id: String(department.id),
      name: department.name,
      code: department.code,
      status: department.status,
    } : null,
  };
}

function toPaginatedResponse(result, mapper) {
  return {
    items: result.items.map(mapper),
    pagination: result.pagination,
  };
}

module.exports = {
  toDepartmentDto,
  toTeamDto,
  toTeamMemberDto,
  toAccountOrganizationDto,
  toPaginatedResponse,
};
