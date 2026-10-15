const express = require('express');
const asyncHandler = require('../../../../middlewares/asyncHandler');
const authPublic = require('../../../auth/public');
const teamsWebhookController = require('../controllers/teamsWebhook.controller');
const teamsAdminController = require('../controllers/teamsAdmin.controller');

const router = express.Router();
const requireConfigWrite = authPublic.authorizeAnyPermission(
  'SYSTEM:CONFIG:WRITE',
  'USERS:WRITE',
);

// Microsoft Graph change notifications webhook (unauthenticated so Graph can POST, validated by clientState/validationToken)
router.post('/webhook', asyncHandler(teamsWebhookController.handleWebhook));
router.get('/oauth/callback', asyncHandler(teamsAdminController.completeOAuth));

// Management & Diagnostics endpoints
router.get('/status', authPublic.authenticate, asyncHandler(teamsAdminController.getStatus));
router.get('/oauth/start', authPublic.authenticate, asyncHandler(teamsAdminController.startOAuth));
router.post('/link', authPublic.authenticate, requireConfigWrite, asyncHandler(teamsAdminController.linkAccount));
router.post('/subscription', authPublic.authenticate, requireConfigWrite, asyncHandler(teamsAdminController.ensureSubscription));
router.post('/sync/:conversationId', authPublic.authenticate, asyncHandler(teamsAdminController.syncConversation));

module.exports = router;
