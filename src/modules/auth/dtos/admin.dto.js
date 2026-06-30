const { toAccountDto, toProfileDto } = require('./auth.dto');

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function parsePermissionCode(code = '') {
  if (code.includes(':')) {
    const [moduleName, action] = code.split(':', 2);
    return { module: moduleName || null, action: action || null };
  }

  const [action, ...moduleParts] = code.split('_');
  return {
    module: moduleParts.length > 0 ? moduleParts.join('_') : null,
    action: action || null,
  };
}

function toRoleDto(role, { includePermissionDetails = true } = {}) {
  if (!role) {
    return null;
  }

  const permissionIds = (role.permissions || []).map((permissionId) => String(permissionId));
  const dto = {
    id: toId(role),
    name: role.name,
    code: role.code,
    description: role.description || null,
    permissions: permissionIds,
    permissionCount: permissionIds.length,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };

  if (includePermissionDetails && role.permissionDetails) {
    dto.permissionDetails = role.permissionDetails.map((permission) => toPermissionDto(permission, {
      includeUsage: false,
    }));
  }

  if (role.userCount !== undefined) {
    dto.userCount = Number(role.userCount || 0);
    dto.deletable = role.deletable !== undefined ? Boolean(role.deletable) : dto.userCount === 0;
  }

  return dto;
}

function toPermissionDto(permission, { includeUsage = true } = {}) {
  if (!permission) {
    return null;
  }

  const codeParts = parsePermissionCode(permission.code);
  const dto = {
    id: toId(permission),
    code: permission.code,
    name: permission.name || null,
    description: permission.description || null,
    module: permission.module || codeParts.module,
    action: permission.action || codeParts.action,
    status: permission.status || 'active',
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };

  if (includeUsage) {
    dto.roleCount = Number(permission.roleCount || 0);
    dto.scopedRoleCount = Number(permission.scopedRoleCount || 0);
    dto.directAssignmentCount = Number(permission.directAssignmentCount || 0);
    dto.usageCount = Number(permission.usageCount || 0);
    dto.deletable = permission.deletable !== undefined ? Boolean(permission.deletable) : undefined;
  }

  return dto;
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

function mapPermissionIds(permissionIds = []) {
  return permissionIds.map((permissionId) => String(permissionId));
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getEffectiveValues(globalValues = [], scopes = [], fieldName) {
  return uniqueValues([
    ...(globalValues || []),
    ...scopes.flatMap((scope) => scope[fieldName] || []),
  ]);
}

function toAccountListDto(account) {
  const profile = account.profile ? toProfileDto(account.profile) : null;
  const organization = account.organization || {};
  const roleAssignments = (account.roleAssignments || []).map((assignment) => ({
    assignmentId: String(assignment.assignmentId || assignment._id || assignment.id),
    roleId: assignment.roleId ? String(assignment.roleId) : null,
    roleCode: assignment.roleCode || null,
    roleName: assignment.roleName || null,
    scopeType: assignment.scopeType,
    scopeId: assignment.scopeId ? String(assignment.scopeId) : null,
    resourceId: assignment.scopeId ? String(assignment.scopeId) : null,
    customPermissionIds: (assignment.customPermissionIds || []).map((permissionId) => String(permissionId)),
    overridePermissionIds: assignment.overridePermissionIds === null || assignment.overridePermissions === null
      ? null
      : mapPermissionIds(assignment.overridePermissionIds || assignment.overridePermissions || []),
    inheritedPermissionIds: mapPermissionIds(assignment.inheritedPermissionIds || []),
    effectivePermissionIds: mapPermissionIds(assignment.effectivePermissionIds || []),
    isPermissionOverridden: assignment.isPermissionOverridden !== undefined
      ? Boolean(assignment.isPermissionOverridden)
      : Array.isArray(assignment.overridePermissionIds || assignment.overridePermissions),
  }));

  return {
    ...toAccountDto(account),
    profile,
    access: toAccessDtoFromScopes(roleAssignments),
    roles: account.roles || [],
    roleAssignments,
    department: organization.department || null,
    team: organization.team || null,
    memberType: organization.memberType || null,
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
    resourceId: scope.scopeId ? String(scope.scopeId) : null,
    scopeName: scope.scopeName || scope.scope?.name || null,
    scope: scope.scope || null,
    resource: scope.resource || null,
    customPermissionIds: (scope.customPermissionIds || []).map((permissionId) => String(permissionId)),
    overridePermissionIds: scope.overridePermissionIds === null || scope.overridePermissions === null
      ? null
      : mapPermissionIds(scope.overridePermissionIds || scope.overridePermissions || []),
    inheritedPermissionIds: mapPermissionIds(scope.inheritedPermissionIds || []),
    effectivePermissionIds: mapPermissionIds(scope.effectivePermissionIds || []),
    isPermissionOverridden: Boolean(scope.isPermissionOverridden),
    roles: scope.roles || [],
    permissions: scope.permissions || [],
  }));
  const globalRoles = roles || [];
  const globalPermissions = permissions || [];
  const nonGlobalScopes = scopedAccess.filter((scope) => scope.scopeType !== 'global');

  return {
    account: toAccountDto(account),
    profile: toProfileDto(profile),
    access: toAccessDtoFromScopes(scopedAccess),
    roles: globalRoles,
    permissions: globalPermissions,
    effectiveRoles: getEffectiveValues(globalRoles, scopedAccess, 'roles'),
    effectivePermissions: getEffectiveValues(globalPermissions, scopedAccess, 'permissions'),
    scopes: nonGlobalScopes,
  };
}

function toAccessAssignmentDto(assignment) {
  if (!assignment) {
    return null;
  }

  return {
    id: toId(assignment),
    accountId: String(assignment.accountId),
    roleId: String(assignment.roleId),
    scopeType: assignment.scopeType,
    scopeId: assignment.scopeId ? String(assignment.scopeId) : null,
    resourceId: assignment.scopeId ? String(assignment.scopeId) : null,
    customPermissionIds: (assignment.customPermissions || []).map((permissionId) => String(permissionId)),
    overridePermissionIds: assignment.overridePermissions === undefined || assignment.overridePermissions === null
      ? null
      : mapPermissionIds(assignment.overridePermissions),
    isPermissionOverridden: Array.isArray(assignment.overridePermissions),
    status: assignment.status,
    role: assignment.role ? toRoleDto(assignment.role) : null,
    scope: assignment.scope ? toScopeRegistryDto(assignment.scope) : null,
    customPermissionDetails: (assignment.customPermissionDetails || []).map(toPermissionDto),
    overridePermissionDetails: (assignment.overridePermissionDetails || []).map(toPermissionDto),
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

function toScopeRegistryDto(scope) {
  if (!scope) {
    return null;
  }

  return {
    id: toId(scope),
    scopeRegistryId: toId(scope),
    scopeType: scope.scopeType,
    scopeId: String(scope.scopeId),
    resourceId: String(scope.scopeId),
    name: scope.name,
    status: scope.status,
    resource: scope.resource || null,
    parentDepartment: scope.parentDepartment || null,
    assignmentCount: Number(scope.assignmentCount || 0),
    createdAt: scope.createdAt,
    updatedAt: scope.updatedAt,
  };
}

function toScopedRolePermissionDto(rule) {
  if (!rule) {
    return null;
  }

  return {
    id: toId(rule),
    scopeType: rule.scopeType,
    scopeId: String(rule.scopeId),
    resourceId: String(rule.scopeId),
    roleId: String(rule.roleId),
    permissionIds: (rule.permissions || rule.permissionIds || []).map((permissionId) => String(permissionId)),
    role: rule.role ? toRoleDto(rule.role) : null,
    scope: rule.scope ? toScopeRegistryDto(rule.scope) : null,
    permissionDetails: (rule.permissionDetails || []).map(toPermissionDto),
    defaultPermissionIds: (rule.defaultPermissions || []).map((permissionId) => String(permissionId)),
    defaultPermissionDetails: (rule.defaultPermissionDetails || []).map(toPermissionDto),
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
