const authenticate = require('./middlewares/authenticate');
const {
  authorizePermissions,
  authorizeAnyPermission,
  authorizeRoles,
} = require('./middlewares/authorization');
const authManager = require('./services/authManager.service');

const publicPort = {
  authenticate,
  authorizePermissions,
  authorizeAnyPermission,
  authorizeRoles,
  getCurrentAccount: authManager.getCurrentAccount,
  invalidatePermissionCache: authManager.invalidatePermissionCache,
};

module.exports = publicPort;
