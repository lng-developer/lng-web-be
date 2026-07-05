const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/fulfillmentPlan.service');
const { selectFulfillmentPlanSchema } = require('../validators/fulfillmentPlan.validator');
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

async function selectFulfillmentPlan(req, res) {
  const payload = assertValid(selectFulfillmentPlanSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.selectFulfillmentPlan(req.params.orderItemId, payload, req.auth),
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
  previewFulfillmentPlan,
  resolveFulfillmentPlan,
  selectFulfillmentPlan,
  confirmFulfillmentPlan: selectFulfillmentPlan,
};
