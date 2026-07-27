const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/notification.controller');

const router = express.Router();

router.get('/', authPublic.authenticate, asyncHandler(controller.listInbox));
router.get('/unread-count', authPublic.authenticate, asyncHandler(controller.getUnreadCount));
router.patch('/read-all', authPublic.authenticate, asyncHandler(controller.markAllRead));
router.patch('/:id/read', authPublic.authenticate, asyncHandler(controller.markRead));

module.exports = router;
