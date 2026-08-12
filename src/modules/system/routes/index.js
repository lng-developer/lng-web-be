const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const service = require('../services/systemHealth.service');

const router = express.Router();
const requireAuditRead = authPublic.authorizePermissions('AUDIT:READ');

router.get('/health', asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await service.getHealth() });
}));

router.get('/logs', authPublic.authenticate, requireAuditRead, asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await service.getLogs(req.query) });
}));

module.exports = router;
