const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/workScore.controller');
const { workScorePermissions } = require('../constants/workScore.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(
  workScorePermissions.READ,
  workScorePermissions.ADJUST,
  'DESIGN:WORK',
  'PRODUCTION:SCALE_WORK',
  'PRODUCTION:READ',
);
const requireAdjust = authPublic.authorizeAnyPermission(workScorePermissions.ADJUST);

router.get('/', authPublic.authenticate, requireRead, asyncHandler(controller.listScores));
router.get('/summary', authPublic.authenticate, requireRead, asyncHandler(controller.summarizeScores));
router.get('/rules', authPublic.authenticate, requireAdjust, asyncHandler(controller.listRules));
router.put('/rules', authPublic.authenticate, requireAdjust, asyncHandler(controller.upsertRule));
router.get('/:scoreId', authPublic.authenticate, requireRead, asyncHandler(controller.getScore));
router.patch('/:scoreId/override', authPublic.authenticate, requireAdjust, asyncHandler(controller.overrideScore));
router.patch('/:scoreId/void', authPublic.authenticate, requireAdjust, asyncHandler(controller.voidScore));

module.exports = router;
