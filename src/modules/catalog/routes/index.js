const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const { psdTemplateUpload } = require('../constants/catalog.constants');
const catalogController = require('../controllers/catalog.controller');

const router = express.Router();
const requireCatalogWrite = authPublic.authorizePermissions('CATALOG:WRITE');
const requireCatalogReadAny = authPublic.authorizeAnyPermission('CATALOG:READ', 'CATALOG:WRITE');
const requireCatalogWriteAny = authPublic.authorizeAnyPermission('CATALOG:WRITE');
const uploadDir = path.join(os.tmpdir(), 'lng-catalog-uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdir(uploadDir, { recursive: true }, (error) => cb(error, uploadDir));
    },
    filename(req, file, cb) {
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '')}`);
    },
  }),
  limits: { fileSize: psdTemplateUpload.maxBytes },
});

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'catalog', status: 'ok' });
});

router.get(
  '/product-type-groups',
  authPublic.authenticate,
  requireCatalogReadAny,
  asyncHandler(catalogController.listProductTypeGroups),
);
router.post(
  '/product-type-groups',
  authPublic.authenticate,
  requireCatalogWrite,
  asyncHandler(catalogController.createProductTypeGroup),
);
router.patch(
  '/product-type-groups/:id',
  authPublic.authenticate,
  requireCatalogWrite,
  asyncHandler(catalogController.updateProductTypeGroup),
);

router.get(
  '/internal-templates',
  authPublic.authenticate,
  requireCatalogReadAny,
  asyncHandler(catalogController.listInternalTemplates),
);
router.post(
  '/internal-templates',
  authPublic.authenticate,
  requireCatalogWrite,
  asyncHandler(catalogController.createInternalTemplate),
);
router.get(
  '/internal-templates/:id',
  authPublic.authenticate,
  requireCatalogReadAny,
  asyncHandler(catalogController.getInternalTemplate),
);
router.patch(
  '/internal-templates/:id',
  authPublic.authenticate,
  requireCatalogWrite,
  asyncHandler(catalogController.updateInternalTemplate),
);

router.get(
  '/listing-options',
  authPublic.authenticate,
  requireCatalogReadAny,
  asyncHandler(catalogController.getListingOptions),
);
router.post(
  '/assets',
  authPublic.authenticate,
  requireCatalogWrite,
  upload.single('file'),
  asyncHandler(catalogController.uploadCatalogAsset),
);

router.get(
  '/listings',
  authPublic.authenticate,
  requireCatalogReadAny,
  asyncHandler(catalogController.listListings),
);
router.post(
  '/listings',
  authPublic.authenticate,
  requireCatalogWriteAny,
  asyncHandler(catalogController.createListing),
);
router.get(
  '/listings/summary',
  authPublic.authenticate,
  requireCatalogReadAny,
  asyncHandler(catalogController.getListingSummary),
);
router.get(
  '/listings/:id',
  authPublic.authenticate,
  requireCatalogReadAny,
  asyncHandler(catalogController.getListing),
);
router.get('/listings/:id/variants', authPublic.authenticate, requireCatalogReadAny, asyncHandler(catalogController.listListingVariants));
router.post('/listings/:id/variants', authPublic.authenticate, requireCatalogWriteAny, asyncHandler(catalogController.createListingVariant));
router.patch('/listings/:id/variants/:variantId', authPublic.authenticate, requireCatalogWriteAny, asyncHandler(catalogController.updateListingVariant));
router.post('/listings/:id/variants/:variantId/default', authPublic.authenticate, requireCatalogWriteAny, asyncHandler(catalogController.setDefaultListingVariant));
router.post('/listings/:id/variants/:variantId/request-psd', authPublic.authenticate, requireCatalogWriteAny, asyncHandler(catalogController.requestListingVariantPsd));
router.post(
  '/listings/:id/approve',
  authPublic.authenticate,
  requireCatalogWriteAny,
  asyncHandler(catalogController.approveListing),
);
router.post(
  '/listings/:id/reject',
  authPublic.authenticate,
  requireCatalogWriteAny,
  asyncHandler(catalogController.rejectListing),
);
router.patch(
  '/listings/:id',
  authPublic.authenticate,
  requireCatalogWriteAny,
  asyncHandler(catalogController.updateListing),
);

module.exports = router;
