const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const shopController = require('../controllers/shop.controller');

const router = express.Router();

const requireShopWrite = authPublic.authorizePermissions('SHOPS:WRITE');
const requireShopReadScope = authPublic.authorizeScopedPermission('SHOPS:READ', (req) => ({
  scopeType: 'shop',
  scopeId: req.params.shopId,
}));
const requireShopWriteScope = authPublic.authorizeScopedPermission('SHOPS:WRITE', (req) => ({
  scopeType: 'shop',
  scopeId: req.params.shopId,
}));

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'shop', status: 'ok' });
});

router.get(
  '/',
  authPublic.authenticate,
  asyncHandler(shopController.listShops),
);
router.post(
  '/',
  authPublic.authenticate,
  requireShopWrite,
  asyncHandler(shopController.createShop),
);
router.get(
  '/:shopId',
  authPublic.authenticate,
  requireShopReadScope,
  asyncHandler(shopController.getShop),
);
router.patch(
  '/:shopId/status',
  authPublic.authenticate,
  requireShopWriteScope,
  asyncHandler(shopController.updateShopStatus),
);

module.exports = router;
