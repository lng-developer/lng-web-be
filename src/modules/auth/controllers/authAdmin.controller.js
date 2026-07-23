const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authAdmin = require('../services/authAdmin.service');
const {
  listAccountsQuerySchema,
  listRbacQuerySchema,
  listAccessAssignmentsQuerySchema,
  listScopeRegistryQuerySchema,
  listScopedRolePermissionQuerySchema,
  accountStatusSchema,
  accountProfileSchema,
  accountEmailSchema,
  accountPasswordSchema,
  accountCreateSchema,
  accountAccessSchema,
  accessAssignmentCreateSchema,
  accessAssignmentUpdateSchema,
  scopeRegistryCreateSchema,
  scopeRegistryUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  rolePermissionSchema,
  scopedRolePermissionSchema,
  permissionCreateSchema,
  permissionUpdateSchema,
  validate,
} = require('../validators/auth.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

async function listAccounts(req, res) {
  const query = assertValid(listAccountsQuerySchema, req.query);
  const result = await authAdmin.listAccounts(query);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createAccount(req, res) {
  const payload = assertValid(accountCreateSchema, req.body);
  const result = await authAdmin.createAccount({
    email: payload.email,
    password: payload.password,
    fullName: payload.fullName,
    assignments: payload.assignments.map((assignment) => ({
      roleId: assignment.roleId,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      customPermissions: assignment.customPermissionIds,
      overridePermissions: assignment.overridePermissionIds,
    })),
  }, req.auth);

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getAccount(req, res) {
  const result = await authAdmin.getAccount(req.params.accountId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateAccountStatus(req, res) {
  const payload = assertValid(accountStatusSchema, req.body);
  const result = await authAdmin.updateAccountStatus(req.params.accountId, payload.status);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateAccountEmail(req, res) {
  const payload = assertValid(accountEmailSchema, req.body);
  const result = await authAdmin.updateAccountEmail(req.params.accountId, payload.email);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateAccountProfile(req, res) {
  const payload = assertValid(accountProfileSchema, req.body);
  const result = await authAdmin.updateProfile(req.params.accountId, payload);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function resetAccountPassword(req, res) {
  const payload = assertValid(accountPasswordSchema, req.body);
  const result = await authAdmin.resetPassword(req.params.accountId, payload.password);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function revokeAccountSessions(req, res) {
  const result = await authAdmin.revokeAccountSessions(req.params.accountId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function archiveAccount(req, res) {
  const result = await authAdmin.archiveAccount(req.params.accountId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateAccountAccess(req, res) {
  const payload = assertValid(accountAccessSchema, req.body);
  const result = await authAdmin.updateAccountAccess(req.params.accountId, {
    roles: payload.roleIds,
    customPermissions: payload.customPermissionIds,
  }, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function listAccessAssignments(req, res) {
  const query = assertValid(listAccessAssignmentsQuerySchema, req.query);
  const result = await authAdmin.listAccessAssignments(query);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createAccessAssignment(req, res) {
  const payload = assertValid(accessAssignmentCreateSchema, req.body);
  const result = await authAdmin.createAccessAssignment({
    accountId: payload.accountId,
    roleId: payload.roleId,
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    customPermissions: payload.customPermissionIds,
    overridePermissions: payload.overridePermissionIds,
  }, req.auth);

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getAccessAssignment(req, res) {
  const result = await authAdmin.getAccessAssignment(req.params.assignmentId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateAccessAssignment(req, res) {
  const payload = assertValid(accessAssignmentUpdateSchema, req.body);
  const result = await authAdmin.updateAccessAssignment(req.params.assignmentId, {
    roleId: payload.roleId,
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    customPermissions: payload.customPermissionIds,
    overridePermissions: payload.overridePermissionIds,
    status: payload.status,
  }, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function deactivateAccessAssignment(req, res) {
  const result = await authAdmin.deactivateAccessAssignment(req.params.assignmentId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function listScopes(req, res) {
  const query = assertValid(listScopeRegistryQuerySchema, req.query);
  const result = await authAdmin.listScopes(query);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createScope(req, res) {
  const payload = assertValid(scopeRegistryCreateSchema, req.body);
  const result = await authAdmin.createScope(payload);

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getScope(req, res) {
  const result = await authAdmin.getScope(req.params.scopeRegistryId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateScope(req, res) {
  const payload = assertValid(scopeRegistryUpdateSchema, req.body);
  const result = await authAdmin.updateScope(req.params.scopeRegistryId, payload);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function deactivateScope(req, res) {
  const result = await authAdmin.deactivateScope(req.params.scopeRegistryId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function listRoles(req, res) {
  const query = assertValid(listRbacQuerySchema, req.query);
  const result = await authAdmin.listRoles(query);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createRole(req, res) {
  const payload = assertValid(roleCreateSchema, req.body);
  const result = await authAdmin.createRole({
    code: payload.code,
    name: payload.name,
    description: payload.description,
    permissions: payload.permissionIds,
  });

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getRole(req, res) {
  const result = await authAdmin.getRole(req.params.roleId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateRole(req, res) {
  const payload = assertValid(roleUpdateSchema, req.body);
  const result = await authAdmin.updateRole(req.params.roleId, {
    code: payload.code,
    name: payload.name,
    description: payload.description,
    permissions: payload.permissionIds,
  });

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function addRolePermission(req, res) {
  const payload = assertValid(rolePermissionSchema, req.body);
  const result = await authAdmin.addRolePermission(req.params.roleId, payload.permissionId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function removeRolePermission(req, res) {
  const result = await authAdmin.removeRolePermission(req.params.roleId, req.params.permissionId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function listScopedRolePermissions(req, res) {
  const query = assertValid(listScopedRolePermissionQuerySchema, req.query);
  const result = await authAdmin.listScopedRolePermissions(query);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function setScopedRolePermissions(req, res) {
  const payload = assertValid(scopedRolePermissionSchema, req.body);
  const result = await authAdmin.setScopedRolePermissions({
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    roleId: payload.roleId,
    permissionIds: payload.permissionIds,
  });

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function deleteRole(req, res) {
  await authAdmin.deleteRole(req.params.roleId);

  res.status(httpStatus.NO_CONTENT).send();
}

async function listPermissions(req, res) {
  const query = assertValid(listRbacQuerySchema, req.query);
  const result = await authAdmin.listPermissions(query);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createPermission(req, res) {
  const payload = assertValid(permissionCreateSchema, req.body);
  const result = await authAdmin.createPermission(payload);

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getPermission(req, res) {
  const result = await authAdmin.getPermission(req.params.permissionId);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updatePermission(req, res) {
  const payload = assertValid(permissionUpdateSchema, req.body);
  const result = await authAdmin.updatePermission(req.params.permissionId, payload);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function deletePermission(req, res) {
  await authAdmin.deletePermission(req.params.permissionId);

  res.status(httpStatus.NO_CONTENT).send();
}

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
  updateAccountStatus,
  updateAccountEmail,
  updateAccountProfile,
  resetAccountPassword,
  revokeAccountSessions,
  archiveAccount,
  updateAccountAccess,
  listAccessAssignments,
  createAccessAssignment,
  getAccessAssignment,
  updateAccessAssignment,
  deactivateAccessAssignment,
  listScopes,
  createScope,
  getScope,
  updateScope,
  deactivateScope,
  listRoles,
  createRole,
  getRole,
  updateRole,
  addRolePermission,
  removeRolePermission,
  listScopedRolePermissions,
  setScopedRolePermissions,
  deleteRole,
  listPermissions,
  createPermission,
  getPermission,
  updatePermission,
  deletePermission,
};
