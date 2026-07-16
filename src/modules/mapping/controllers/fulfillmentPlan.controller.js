const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/fulfillmentPlan.service');
const {
  configWorkbenchQuerySchema,
  recheckUnmatchedSchema,
  searchVendorCandidatesSchema,
  selectFulfillmentPlanSchema,
  summaryQuerySchema,
} = require('../validators/fulfillmentPlan.validator');
const { assertValid } = require('./requestValidation');

async function previewFulfillmentPlan(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.previewFulfillmentPlan(req.params.orderItemId, req.body || {}, req.auth),
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

async function getMappingConfigWorkbench(req, res) {
  const query = assertValid(configWorkbenchQuerySchema, req.query || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getMappingConfigWorkbench(query, req.auth),
  });
}

async function summarizeMapping(req, res) {
  const query = assertValid(summaryQuerySchema, req.query || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.summarizeMapping(query, req.auth),
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

async function getFulfillmentPlanForOrderItem(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getFulfillmentPlanForOrderItem(req.params.orderItemId, req.auth),
  });
}

module.exports = {
  getFulfillmentPlanForOrderItem,
  getMappingConfigWorkbench,
  previewFulfillmentPlan,
  recheckFulfillmentPlan,
  recheckUnmatchedFulfillmentPlans,
  resolveFulfillmentPlan,
  searchVendorCandidates,
  selectFulfillmentPlan,
  summarizeMapping,
  confirmFulfillmentPlan: selectFulfillmentPlan,
};
