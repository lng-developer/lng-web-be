const { toAccountDto, toProfileDto } = require('./auth.dto');

function toRoleDto(role) {
  if (!role) {
    return null;
  }

  return {
    id: String(role._id || role.id),
    name: role.name,
    code: role.code,
    permissions: (role.permissions || []).map((permissionId) => String(permissionId)),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function toPermissionDto(permission) {
  if (!permission) {
    return null;
  }

  return {
    id: String(permission._id || permission.id),
    code: permission.code,
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
}

function toAccessDtoFromScopes(scopes = []) {
  const globalScopes = scopes.filter((scope) => scope.scopeType === 'global');
  const roleIds = globalScopes
    .map((scope) => scope.roleId)
    .filter(Boolean)
    .map((roleId) => String(roleId));
  const customPermissionIds = globalScopes
    .flatMap((scope) => scope.customPermissionIds || scope.customPermissions || [])
    .filter(Boolean)
    .map((permissionId) => String(permissionId));

  return {
    roleIds: [...new Set(roleIds)],
    customPermissionIds: [...new Set(customPermissionIds)],
  };
}

function toAccountListDto(account) {
  return {
    ...toAccountDto(account),
  };
}

function toAccountAdminDto({
  account,
  profile,
  roles,
  permissions,
  scopes,
} = {}) {
  const scopedAccess = (scopes || []).map((scope) => ({
    assignmentId: String(scope.assignmentId || scope._id || scope.id),
    roleId: scope.roleId ? String(scope.roleId) : null,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId ? String(scope.scopeId) : null,
    customPermissionIds: (scope.customPermissionIds || []).map((permissionId) => String(permissionId)),
    roles: scope.roles || [],
    permissions: scope.permissions || [],
  }));

  return {
    account: toAccountDto(account),
    profile: toProfileDto(profile),
    access: toAccessDtoFromScopes(scopedAccess),
    roles,
    permissions,
    scopes: scopedAccess,
  };
}

function toAccessAssignmentDto(assignment) {
  if (!assignment) {
    return null;
  }

  return {
    id: String(assignment._id || assignment.id),
    accountId: String(assignment.accountId),
    roleId: String(assignment.roleId),
    scopeType: assignment.scopeType,
    scopeId: assignment.scopeId ? String(assignment.scopeId) : null,
    customPermissionIds: (assignment.customPermissions || []).map((permissionId) => String(permissionId)),
    status: assignment.status,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

function toScopeRegistryDto(scope) {
  if (!scope) {
    return null;
  }

  return {
    id: String(scope._id || scope.id),
    scopeType: scope.scopeType,
    scopeId: String(scope.scopeId),
    name: scope.name,
    status: scope.status,
    createdAt: scope.createdAt,
    updatedAt: scope.updatedAt,
  };
}

function toScopedRolePermissionDto(rule) {
  if (!rule) {
    return null;
  }

  return {
    id: String(rule._id || rule.id),
    scopeType: rule.scopeType,
    scopeId: String(rule.scopeId),
    roleId: String(rule.roleId),
    permissionIds: (rule.permissions || rule.permissionIds || []).map((permissionId) => String(permissionId)),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

module.exports = {
  toRoleDto,
  toPermissionDto,
  toAccountListDto,
  toAccountAdminDto,
  toAccessAssignmentDto,
  toScopeRegistryDto,
  toScopedRolePermissionDto,
};
