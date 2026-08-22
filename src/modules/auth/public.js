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
const extensionToken = require('./services/extensionToken.service');

const publicPort = {
  authenticate,
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
  isSuperAdmin,
  authorizeAnyPermission,
  authorizeRoles,
  getCurrentAccount: authManager.getCurrentAccount,
  verifyAccessToken: authManager.verifyAccessToken,
  buildAuthContext: authManager.buildAuthContext,
  invalidatePermissionCache: authManager.invalidatePermissionCache,
  filterAssignableAccountIds: authManager.filterAssignableAccountIds,
  listChatDirectory: authManager.listChatDirectory,
  listAccountIdsByScopes: authManager.listAccountIdsByScopes,
  listTeamScopedAccountIds: authManager.listTeamScopedAccountIds,
  hasTeamQueueScope: authManager.hasTeamQueueScope,
  listMigrationAccounts: authManager.listMigrationAccounts,
  migrateLegacyIdentities: authMigration.migrateLegacyIdentities,
  hasPermissionCodes: authManager.hasPermissionCodes,
  listScopes: authAdmin.listScopes,
  listAssignableRoles: authAdmin.listAssignableRoles,
  syncScopeRegistry: authAdmin.syncScopeRegistry,
  createProvisionedAccount: authAdmin.createProvisionedAccount,
  ensureTeamLeaderAssignment: authAdmin.ensureTeamLeaderAssignment,
  ensureTeamMemberAssignment: authAdmin.ensureTeamMemberAssignment,
  deactivateTeamRoleAssignments: authAdmin.deactivateTeamRoleAssignments,
  getExtensionTokenMetadataByIds: extensionToken.getMetadataByIds,
};

module.exports = publicPort;
