const permissionRepository = require('../repositories/permission.repository');
const roleRepository = require('../repositories/role.repository');
const accessAssignmentRepository = require('../repositories/accessAssignment.repository');
const scopeRegistryRepository = require('../repositories/scopeRegistry.repository');
const scopedRolePermissionRepository = require('../repositories/scopedRolePermission.repository');
const { accessScopeTypes } = require('../constants/auth.constants');
const { uniqueIds } = require('./authAdmin.helpers');

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
  const overridePermissionIds = uniqueIds(assignments.flatMap((assignment) => (
    Array.isArray(assignment.overridePermissions) ? assignment.overridePermissions : []
  )));
  const [roles, customPermissionDetails] = await Promise.all([
    roleIds.length > 0 ? roleRepository.findByIds(roleIds) : [],
    getPermissionDetails([...customPermissionIds, ...overridePermissionIds]),
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
      overridePermissionDetails: (assignment.overridePermissions || [])
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

module.exports = {
  enrichAccessAssignments,
  enrichAccountsWithOrganization,
  enrichAuthModelScopes,
  enrichPermissionsWithUsage,
  enrichRolesWithPermissionDetails,
  enrichScopedRolePermissions,
  enrichScopesWithMetadata,
  getPermissionDetails,
};
