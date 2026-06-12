const express = require('express');

const integration = require('./integration');
const catalog = require('./catalog');
const order = require('./order');
const production = require('./production');
const finance = require('./finance');
const media = require('./media');
const mapping = require('./mapping');
const shipment = require('./shipment');
const vendor = require('./vendor');
const auth = require('./auth');
const shop = require('./shop');
const audit = require('./audit');
const report = require('./report');
const vendorSubmission = require('./vendorSubmission');

const modules = {
  integration,
  catalog,
  order,
  production,
  finance,
  media,
  mapping,
  shipment,
  vendor,
  auth,
  shop,
  audit,
  report,
  vendorSubmission,
};

const router = express.Router();

router.use('/integration', integration.router);
router.use('/catalog', catalog.router);
router.use('/orders', order.router);
router.use('/production', production.router);
router.use('/finance', finance.router);
router.use('/media', media.router);
router.use('/mapping', mapping.router);
router.use('/shipments', shipment.router);
router.use('/vendors', vendor.router);
router.use('/auth', auth.router);
router.use('/shops', shop.router);
router.use('/audit', audit.router);
router.use('/reports', report.router);
router.use('/vendor-submissions', vendorSubmission.router);

module.exports = {
  router,
  modules,
};
