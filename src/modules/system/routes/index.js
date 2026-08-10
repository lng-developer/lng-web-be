const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const service = require('../services/systemHealth.service');

const router = express.Router();

router.get('/health', asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await service.getHealth() });
}));

module.exports = router;
