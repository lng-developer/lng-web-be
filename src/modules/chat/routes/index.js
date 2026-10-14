const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/chat.controller');

const router = express.Router();
router.get('/unread-count', authPublic.authenticate, asyncHandler(controller.getUnreadCount));

router.get('/conversations', authPublic.authenticate, asyncHandler(controller.listConversations));
router.get('/participants', authPublic.authenticate, asyncHandler(controller.listParticipants));
router.post('/conversations', authPublic.authenticate, asyncHandler(controller.createConversation));
router.get('/conversations/:conversationId/messages', authPublic.authenticate, asyncHandler(controller.listMessages));
router.post('/conversations/:conversationId/messages', authPublic.authenticate, asyncHandler(controller.sendMessage));
router.patch('/conversations/:conversationId/read', authPublic.authenticate, asyncHandler(controller.markRead));

module.exports = router;
