const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const { reportPermissions } = require('../constants/report.constants');
const controller = require('../controllers/report.controller');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(reportPermissions.READ);

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'report', status: 'ok' });
});

router.get(
  '/finance/daily',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getFinanceDaily),
);

router.get(
  '/finance/by-seller',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getFinanceBySeller),
);

router.get(
  '/finance/by-team',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getFinanceByTeam),
);

router.get(
  '/vendor/performance',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getVendorPerformance),
);

router.get(
  '/operations/overview',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getOperationsOverview),
);

module.exports = router;
