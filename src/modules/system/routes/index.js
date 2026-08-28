const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../auth/public');
const dashboardController = require('../controllers/systemDashboard.controller');
const service = require('../services/systemHealth.service');

const router = express.Router();
const requireAuditRead = authPublic.authorizePermissions('AUDIT:READ');
const requireSystemDashboard = (req, res, next) => {
  const permissions = req.auth?.permissions || [];
  if (authPublic.isSuperAdmin(req.auth) || ['AUTH:READ', 'AUDIT:READ'].some((permission) => permissions.includes(permission))) {
    return next();
  }
  return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
};

router.get('/health', asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await service.getHealth() });
}));

router.get('/dashboard', authPublic.authenticate, requireSystemDashboard, asyncHandler(dashboardController.getDashboard));

router.get('/logs', authPublic.authenticate, requireAuditRead, asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await service.getLogs(req.query) });
}));

module.exports = router;
