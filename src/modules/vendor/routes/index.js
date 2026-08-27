const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/vendor.controller');

const router = express.Router();
const requireVendorRead = authPublic.authorizePermissions('VENDORS:READ');
const requireVendorWrite = authPublic.authorizePermissions('VENDORS:WRITE');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'vendor', status: 'ok' });
});

router.get(
  '/',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.listVendors),
);
router.post(
  '/',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.createVendor),
);

router.get(
  '/products',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.listVendorProducts),
);
router.post(
  '/products',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.createVendorProduct),
);
router.get(
  '/products/export.csv',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.exportVendorCatalog),
);
router.post(
  '/products/catalog-import',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.importVendorCatalog),
);
router.post('/products/import', authPublic.authenticate, requireVendorWrite, asyncHandler(controller.importVendorProducts));
router.get(
  '/migration/review',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.listVendorMigrationReviews),
);
router.patch(
  '/migration/review/product-type-group',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.assignVendorMigrationProductTypeGroup),
);
router.get(
  '/products/:productId/cost-centers',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.listVendorCostCenters),
);
router.post(
  '/products/:productId/cost-centers',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.createVendorCostCenter),
);
router.post('/products/:productId/cost-centers/import', authPublic.authenticate, requireVendorWrite, asyncHandler(controller.importVendorCostCenters));
router.patch(
  '/products/:productId/cost-centers/:costCenterId',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.updateVendorCostCenter),
);
router.get(
  '/products/:id',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.getVendorProduct),
);
router.patch(
  '/products/:id',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.updateVendorProduct),
);

router.get(
  '/:vendorId/integration',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.getVendorIntegrationConfig),
);
router.patch(
  '/:vendorId/integration',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.updateVendorIntegrationConfig),
);
router.post(
  '/:vendorId/integration/refresh',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.refreshVendorIntegrationCredential),
);

router.get(
  '/:id',
  authPublic.authenticate,
  requireVendorRead,
  asyncHandler(controller.getVendor),
);
router.patch(
  '/:id',
  authPublic.authenticate,
  requireVendorWrite,
  asyncHandler(controller.updateVendor),
);

module.exports = router;
