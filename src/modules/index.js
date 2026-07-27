const express = require('express');

const integration = require('./integration');
const catalog = require('./catalog');
const order = require('./order');
const customization = require('./customization');
const production = require('./production');
const finance = require('./finance');
const design = require('./design');
const media = require('./media');
const mapping = require('./mapping');
const shipment = require('./shipment');
const vendor = require('./vendor');
const auth = require('./auth');
const shop = require('./shop');
const organization = require('./organization');
const audit = require('./audit');
const report = require('./report');
const vendorSubmission = require('./vendorSubmission');
const hr = require('./hr');
const notification = require('./notification');

const modules = {
  integration,
  catalog,
  order,
  customization,
  production,
  finance,
  design,
  media,
  mapping,
  shipment,
  vendor,
  auth,
  shop,
  organization,
  audit,
  report,
  vendorSubmission,
  hr,
  notification,
};

const router = express.Router();

router.use('/integration', integration.router);
router.use('/hr/integrations', integration.hrRouter);
router.use('/catalog', catalog.router);
router.use('/orders', order.router);
router.use('/customizations', customization.router);
router.use('/production', production.router);
router.use('/finance', finance.router);
router.use('/design', design.router);
router.use('/media', media.router);
router.use('/mapping', mapping.router);
router.use('/shipments', shipment.router);
router.use('/vendors', vendor.router);
router.use('/auth', auth.router);
router.use('/shops', shop.router);
router.use('/organization', organization.router);
router.use('/audit', audit.router);
router.use('/reports', report.router);
router.use('/vendor-submissions', vendorSubmission.router);
router.use('/hr', hr.router);
router.use('/notifications', notification.router);

module.exports = {
  router,
  modules,
};
