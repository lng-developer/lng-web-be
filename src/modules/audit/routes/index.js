const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/auditEvent.controller');

const router = express.Router();
const requireAuditRead = authPublic.authorizeAnyPermission('AUDIT:READ');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'audit', status: 'ok' });
});

router.get('/events', authPublic.authenticate, requireAuditRead, asyncHandler(controller.listEvents));
router.get('/events/export.csv', authPublic.authenticate, requireAuditRead, asyncHandler(controller.exportEventsCsv));
router.get('/events/:eventId', authPublic.authenticate, requireAuditRead, asyncHandler(controller.getEvent));

module.exports = router;
