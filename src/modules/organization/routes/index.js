const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const organizationController = require('../controllers/organization.controller');

const router = express.Router();

const requireAuthRead = authPublic.authorizePermissions('AUTH:READ');
const requireAuthWrite = authPublic.authorizePermissions('AUTH:WRITE');
const requireOrganizationRead = authPublic.authorizeAnyPermission('AUTH:READ', 'TEAMS:READ', 'TEAMS:WRITE');
const requireTeamWrite = authPublic.authorizeAnyPermission('AUTH:WRITE', 'TEAMS:WRITE');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'organization', status: 'ok' });
});

router.get(
  '/departments',
  authPublic.authenticate,
  requireOrganizationRead,
  asyncHandler(organizationController.listDepartments),
);
router.post(
  '/departments',
  authPublic.authenticate,
  requireAuthWrite,
  asyncHandler(organizationController.createDepartment),
);
router.get(
  '/departments/:departmentId',
  authPublic.authenticate,
  requireOrganizationRead,
  asyncHandler(organizationController.getDepartment),
);
router.patch(
  '/departments/:departmentId',
  authPublic.authenticate,
  requireAuthWrite,
  asyncHandler(organizationController.updateDepartment),
);

router.get(
  '/member-candidates',
  authPublic.authenticate,
  requireTeamWrite,
  asyncHandler(organizationController.listMemberCandidates),
);
router.get(
  '/teams',
  authPublic.authenticate,
  requireOrganizationRead,
  asyncHandler(organizationController.listTeams),
);
router.post(
  '/teams',
  authPublic.authenticate,
  requireAuthWrite,
  asyncHandler(organizationController.createTeam),
);
router.get(
  '/teams/:teamId',
  authPublic.authenticate,
  requireOrganizationRead,
  asyncHandler(organizationController.getTeam),
);
router.patch(
  '/teams/:teamId',
  authPublic.authenticate,
  requireAuthWrite,
  asyncHandler(organizationController.updateTeam),
);
router.get(
  '/teams/:teamId/members',
  authPublic.authenticate,
  requireOrganizationRead,
  asyncHandler(organizationController.listTeamMembers),
);
router.post(
  '/teams/:teamId/members',
  authPublic.authenticate,
  requireTeamWrite,
  asyncHandler(organizationController.addTeamMember),
);
router.delete(
  '/teams/:teamId/members/:accountId',
  authPublic.authenticate,
  requireTeamWrite,
  asyncHandler(organizationController.removeTeamMember),
);

module.exports = router;
