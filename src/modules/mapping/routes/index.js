const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/fulfillmentPlan.controller');
const ruleController = require('../controllers/mappingRule.controller');

const router = express.Router();
const requireMappingRead = authPublic.authorizeAnyPermission('MAPPING:READ');
const requireMappingWrite = authPublic.authorizeAnyPermission('MAPPING:WRITE');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'mapping', status: 'ok' });
});

router.get(
  '/normalization-rules',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.listNormalizationRules),
);

router.post(
  '/normalization-rules',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.createNormalizationRule),
);

router.get(
  '/normalization-rules/:id',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.getNormalizationRule),
);

router.patch(
  '/normalization-rules/:id',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.updateNormalizationRule),
);

router.get(
  '/semantic-rules',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.listNormalizationRules),
);

router.post(
  '/semantic-rules',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.createSemanticRule),
);

router.get(
  '/semantic-rules/:id',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.getNormalizationRule),
);

router.patch(
  '/semantic-rules/:id',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.updateSemanticRule),
);

router.get(
  '/value-aliases',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.listNormalizationRules),
);

router.post(
  '/value-aliases',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.createValueAlias),
);

router.get(
  '/value-aliases/:id',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.getNormalizationRule),
);

router.patch(
  '/value-aliases/:id',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.updateValueAlias),
);

router.get(
  '/vendor-routing-rules',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.listVendorRoutingRules),
);

router.post(
  '/vendor-routing-rules',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.createVendorRoutingRule),
);

router.patch(
  '/vendor-routing-rules/reorder',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.reorderVendorRoutingRules),
);

router.get(
  '/vendor-routing-rules/:id',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.getVendorRoutingRule),
);

router.patch(
  '/vendor-routing-rules/:id',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.updateVendorRoutingRule),
);

router.get(
  '/sku-config-rules',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.listSkuConfigRules),
);

router.post(
  '/sku-config-rules',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.createSkuConfigRule),
);

router.get(
  '/sku-config-rules/:id',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.getSkuConfigRule),
);

router.patch(
  '/sku-config-rules/:id',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.updateSkuConfigRule),
);

router.get(
  '/sku-normalize-rules',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.listSkuNormalizeRules),
);

router.post(
  '/sku-normalize-rules',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.createSkuNormalizeRule),
);

router.get(
  '/sku-normalize-rules/:id',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(ruleController.getSkuNormalizeRule),
);

router.patch(
  '/sku-normalize-rules/:id',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(ruleController.updateSkuNormalizeRule),
);

router.post(
  '/order-items/:orderItemId/preview',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(controller.previewFulfillmentPlan),
);

router.post(
  '/order-items/:orderItemId/vendor-candidates/search',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(controller.searchVendorCandidates),
);

router.post(
  '/order-items/:orderItemId/resolve',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(controller.resolveFulfillmentPlan),
);

router.post(
  '/order-items/:orderItemId/select',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(controller.selectFulfillmentPlan),
);

router.post(
  '/order-items/:orderItemId/confirm',
  authPublic.authenticate,
  requireMappingWrite,
  asyncHandler(controller.selectFulfillmentPlan),
);

router.get(
  '/order-items/:orderItemId/plan',
  authPublic.authenticate,
  requireMappingRead,
  asyncHandler(controller.getFulfillmentPlanForOrderItem),
);

module.exports = router;
