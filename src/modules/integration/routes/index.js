const express = require('express');
const externalOrderImport = require('../externalOrderImport/routes/externalOrderImport.routes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'integration', status: 'ok' });
});

router.use('/external-order-imports', externalOrderImport);

module.exports = router;
