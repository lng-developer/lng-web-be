const httpStatus = require('../../../shared/constants/httpStatus');
const { performance } = require('node:perf_hooks');
const service = require('../services/fulfillmentPlan.service');
const {
  recheckUnmatchedSchema,
  manualVendorProductOptionsSchema,
  manualVendorProductsSchema,
  manualVendorSearchSchema,
  searchVendorCandidatesSchema,
  selectFulfillmentPlanSchema,
  summaryQuerySchema,
  unmatchedOrderItemsQuerySchema,
} = require('../validators/fulfillmentPlan.validator');
const { assertValid } = require('./requestValidation');

async function previewFulfillmentPlan(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.previewFulfillmentPlan(req.params.orderItemId, {
      ...(req.body || {}),
      includeCandidates: req.body?.includeCandidates === true,
    }, req.auth),
  });
}

async function resolveFulfillmentPlan(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.resolveFulfillmentPlan(req.params.orderItemId, req.body || {}, req.auth),
  });
}

async function recheckFulfillmentPlan(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckFulfillmentPlan(req.params.orderItemId, req.body || {}, req.auth),
  });
}

async function recheckUnmatchedFulfillmentPlans(req, res) {
  const payload = assertValid(recheckUnmatchedSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckUnmatchedFulfillmentPlans(payload, req.auth),
  });
}

async function summarizeMapping(req, res) {
  const query = assertValid(summaryQuerySchema, req.query || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.summarizeMapping(query, req.auth),
  });
}

async function listUnmatchedOrderItems(req, res) {
  const query = assertValid(unmatchedOrderItemsQuerySchema, req.query || {});
  const startedAt = performance.now();
  const data = await service.listUnmatchedOrderItems(query, req.auth);
  const appMs = Math.round(performance.now() - startedAt);
  res.set('Server-Timing', `app;dur=${appMs}, mongo;dur=${data.timing?.repositoryMs || 0}`);
  res.status(httpStatus.OK).json({
    success: true,
    data,
  });
}

async function selectFulfillmentPlan(req, res) {
  const payload = assertValid(selectFulfillmentPlanSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.selectFulfillmentPlan(req.params.orderItemId, payload, req.auth),
  });
}

async function searchVendorCandidates(req, res) {
  const payload = assertValid(searchVendorCandidatesSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.searchVendorCandidatesForOrderItem(req.params.orderItemId, payload, req.auth),
  });
}

async function searchManualVendors(req, res) {
  const query = assertValid(manualVendorSearchSchema, req.query || {});
  res.status(httpStatus.OK).json({ success: true, data: await service.searchManualVendors(query) });
}

async function listManualVendorProducts(req, res) {
  const query = assertValid(manualVendorProductsSchema, req.query || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listManualVendorProducts(req.params.vendorId, query),
  });
}

async function getManualVendorProductOptions(req, res) {
  const query = assertValid(manualVendorProductOptionsSchema, req.query || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getManualVendorProductOptions(req.params.vendorProductId, query),
  });
}

async function getFulfillmentPlanForOrderItem(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getFulfillmentPlanForOrderItem(req.params.orderItemId, req.auth),
  });
}

module.exports = {
  getFulfillmentPlanForOrderItem,
  listUnmatchedOrderItems,
  searchManualVendors,
  listManualVendorProducts,
  getManualVendorProductOptions,
  previewFulfillmentPlan,
  recheckFulfillmentPlan,
  recheckUnmatchedFulfillmentPlans,
  resolveFulfillmentPlan,
  searchVendorCandidates,
  selectFulfillmentPlan,
  summarizeMapping,
};
