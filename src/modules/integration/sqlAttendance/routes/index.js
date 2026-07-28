const express = require('express');
const asyncHandler = require('../../../../middlewares/asyncHandler');
const authPublic = require('../../../auth/public');
const controller = require('../controllers/sqlAttendance.controller');
const { validateSync } = require('../validators/sqlAttendance.validator');

const router = express.Router();
const requireManage = authPublic.authorizeAnyPermission('HR_INTEGRATIONS:MANAGE');

router.post('/sync', authPublic.authenticate, requireManage, validateSync, asyncHandler(controller.sync));
router.get('/status', authPublic.authenticate, requireManage, asyncHandler(controller.status));

module.exports = router;
