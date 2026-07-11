const authenticate = require('./middlewares/authenticate');
const {
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
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
  authorizeAnyPermission,
  authorizeRoles,
  getCurrentAccount: authManager.getCurrentAccount,
  invalidatePermissionCache: authManager.invalidatePermissionCache,
  findProfileByEmployeeCode: authManager.findProfileByEmployeeCode,
  listProfilesByAccountIds: authManager.listProfilesByAccountIds,
  listProfilesByEmployeeCodes: authManager.listProfilesByEmployeeCodes,
  listAssignableProfiles: authManager.listAssignableProfiles,
  syncScopeRegistry: authAdmin.syncScopeRegistry,
  ensureTeamLeaderAssignment: authAdmin.ensureTeamLeaderAssignment,
  ensureTeamMemberAssignment: authAdmin.ensureTeamMemberAssignment,
  deactivateTeamRoleAssignments: authAdmin.deactivateTeamRoleAssignments,
};

module.exports = publicPort;
