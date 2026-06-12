const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middlewares/authenticate');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'auth', status: 'ok' });
});

router.post('/register', asyncHandler(authController.register));
router.post('/login', asyncHandler(authController.login));
router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));
router.get('/me', authenticate, asyncHandler(authController.me));

module.exports = router;
