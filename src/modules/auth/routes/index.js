const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authController = require('../controllers/auth.controller');
const authAdminController = require('../controllers/authAdmin.controller');
const authenticate = require('../middlewares/authenticate');
const { authorizePermissions } = require('../middlewares/authorization');
const { createAuthRateLimit } = require('../middlewares/authRateLimit');

const router = express.Router();
const requireAuthRead = authorizePermissions('AUTH:READ');
const requireAuthWrite = authorizePermissions('AUTH:WRITE');
const limitLogin = createAuthRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
// const limitRefresh = createAuthRateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'auth', status: 'ok' });
});

router.post('/register', asyncHandler(authController.register));
router.post('/login', limitLogin, asyncHandler(authController.login));
router.post('/refresh', asyncHandler(authController.refresh)); // Re-enable limitRefresh before production.
router.post('/logout', asyncHandler(authController.logout));
router.get('/me', authenticate, asyncHandler(authController.me));
router.post('/me/change-password', authenticate, asyncHandler(authController.changeOwnPassword));

router.get(
  '/accounts',
  authenticate,
  requireAuthRead,
  asyncHandler(authAdminController.listAccounts),
);
router.post(
  '/accounts',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.createAccount),
);
router.get(
  '/accounts/:accountId',
  authenticate,
  requireAuthRead,
  asyncHandler(authAdminController.getAccount),
);
router.patch(
  '/accounts/:accountId/status',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.updateAccountStatus),
);
router.patch(
  '/accounts/:accountId/email',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.updateAccountEmail),
);
router.patch(
  '/accounts/:accountId/password',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.resetAccountPassword),
);
router.post(
  '/accounts/:accountId/revoke-sessions',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.revokeAccountSessions),
);
router.patch(
  '/accounts/:accountId/access',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.updateAccountAccess),
);
router.delete(
  '/accounts/:accountId',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.archiveAccount),
);

router.get('/scopes', authenticate, requireAuthRead, asyncHandler(authAdminController.listScopes));
router.post('/scopes', authenticate, requireAuthWrite, asyncHandler(authAdminController.createScope));
router.get('/scopes/:scopeRegistryId', authenticate, requireAuthRead, asyncHandler(authAdminController.getScope));
router.patch('/scopes/:scopeRegistryId', authenticate, requireAuthWrite, asyncHandler(authAdminController.updateScope));
router.delete('/scopes/:scopeRegistryId', authenticate, requireAuthWrite, asyncHandler(authAdminController.deactivateScope));

router.get(
  '/access-assignments',
  authenticate,
  requireAuthRead,
  asyncHandler(authAdminController.listAccessAssignments),
);
router.post(
  '/access-assignments',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.createAccessAssignment),
);
router.get(
  '/access-assignments/:assignmentId',
  authenticate,
  requireAuthRead,
  asyncHandler(authAdminController.getAccessAssignment),
);
router.patch(
  '/access-assignments/:assignmentId',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.updateAccessAssignment),
);
router.delete(
  '/access-assignments/:assignmentId',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.deactivateAccessAssignment),
);

router.get(
  '/scoped-role-permissions',
  authenticate,
  requireAuthRead,
  asyncHandler(authAdminController.listScopedRolePermissions),
);
router.put(
  '/scoped-role-permissions',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.setScopedRolePermissions),
);

router.get('/roles', authenticate, requireAuthRead, asyncHandler(authAdminController.listRoles));
router.post('/roles', authenticate, requireAuthWrite, asyncHandler(authAdminController.createRole));
router.get('/roles/:roleId', authenticate, requireAuthRead, asyncHandler(authAdminController.getRole));
router.patch('/roles/:roleId', authenticate, requireAuthWrite, asyncHandler(authAdminController.updateRole));
router.post('/roles/:roleId/permissions', authenticate, requireAuthWrite, asyncHandler(authAdminController.addRolePermission));
router.delete(
  '/roles/:roleId/permissions/:permissionId',
  authenticate,
  requireAuthWrite,
  asyncHandler(authAdminController.removeRolePermission),
);
router.delete('/roles/:roleId', authenticate, requireAuthWrite, asyncHandler(authAdminController.deleteRole));

router.get('/permissions', authenticate, requireAuthRead, asyncHandler(authAdminController.listPermissions));
router.post('/permissions', authenticate, requireAuthWrite, asyncHandler(authAdminController.createPermission));
router.get('/permissions/:permissionId', authenticate, requireAuthRead, asyncHandler(authAdminController.getPermission));
router.patch('/permissions/:permissionId', authenticate, requireAuthWrite, asyncHandler(authAdminController.updatePermission));
router.delete('/permissions/:permissionId', authenticate, requireAuthWrite, asyncHandler(authAdminController.deletePermission));

module.exports = router;
