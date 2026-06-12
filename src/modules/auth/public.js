const authenticate = require('./middlewares/authenticate');
const {
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
  authorizeAnyPermission,
  authorizeRoles,
} = require('./middlewares/authorization');
const authManager = require('./services/authManager.service');

const publicPort = {
  authenticate,
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
  authorizeAnyPermission,
  authorizeRoles,
  getCurrentAccount: authManager.getCurrentAccount,
  invalidatePermissionCache: authManager.invalidatePermissionCache,
};

module.exports = publicPort;
