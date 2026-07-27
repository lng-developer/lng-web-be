const authenticate = require('./middlewares/authenticate');
const {
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
  isSuperAdmin,
  authorizeAnyPermission,
  authorizeRoles,
} = require('./middlewares/authorization');
const authManager = require('./services/authManager.service');
const authAdmin = require('./services/authAdmin.service');

const publicPort = {
  authenticate,
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
  isSuperAdmin,
  authorizeAnyPermission,
  authorizeRoles,
  getCurrentAccount: authManager.getCurrentAccount,
  invalidatePermissionCache: authManager.invalidatePermissionCache,
  findProfileByEmployeeCode: authManager.findProfileByEmployeeCode,
  listProfilesByAccountIds: authManager.listProfilesByAccountIds,
  listProfilesByEmployeeCodes: authManager.listProfilesByEmployeeCodes,
  listAssignableProfiles: authManager.listAssignableProfiles,
  listMigrationAccounts: authManager.listMigrationAccounts,
  hasPermissionCodes: authManager.hasPermissionCodes,
  listScopes: authAdmin.listScopes,
  syncScopeRegistry: authAdmin.syncScopeRegistry,
  ensureTeamLeaderAssignment: authAdmin.ensureTeamLeaderAssignment,
  ensureTeamMemberAssignment: authAdmin.ensureTeamMemberAssignment,
  deactivateTeamRoleAssignments: authAdmin.deactivateTeamRoleAssignments,
};

module.exports = publicPort;
