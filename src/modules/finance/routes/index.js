const express = require('express');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'finance', status: 'ok' });
});

module.exports = router;
