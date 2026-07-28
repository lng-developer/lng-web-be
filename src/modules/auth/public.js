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
const authMigration = require('./services/authMigration.service');

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
  filterAssignableAccountIds: authManager.filterAssignableAccountIds,
  listMigrationAccounts: authManager.listMigrationAccounts,
  migrateLegacyIdentities: authMigration.migrateLegacyIdentities,
  hasPermissionCodes: authManager.hasPermissionCodes,
  listScopes: authAdmin.listScopes,
  syncScopeRegistry: authAdmin.syncScopeRegistry,
  ensureTeamLeaderAssignment: authAdmin.ensureTeamLeaderAssignment,
  ensureTeamMemberAssignment: authAdmin.ensureTeamMemberAssignment,
  deactivateTeamRoleAssignments: authAdmin.deactivateTeamRoleAssignments,
};

module.exports = publicPort;
