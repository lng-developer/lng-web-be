const express = require('express');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'audit', status: 'ok' });
});

module.exports = router;
