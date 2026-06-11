const express = require('express');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'media', status: 'ok' });
});

module.exports = router;
