const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/listingLaunch.controller');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission('CATALOG:READ', 'CATALOG:WRITE');
const requireWrite = authPublic.authorizeAnyPermission('CATALOG:WRITE');

router.get('/', authPublic.authenticate, requireRead, asyncHandler(controller.listListingLaunches));
router.post('/', authPublic.authenticate, requireWrite, asyncHandler(controller.createListingLaunch));
router.get('/:id', authPublic.authenticate, requireRead, asyncHandler(controller.getListingLaunch));
router.patch('/:id', authPublic.authenticate, requireWrite, asyncHandler(controller.updateListingLaunch));
router.post('/:id/select-product', authPublic.authenticate, requireWrite, asyncHandler(controller.selectProduct));

module.exports = router;
