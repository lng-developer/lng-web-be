const fulfillmentPlanService = require('./services/fulfillmentPlan.service');

const publicPort = {
  getFulfillmentPlanForOrderItem: fulfillmentPlanService.getFulfillmentPlanForOrderItem,
  previewFulfillmentPlan: fulfillmentPlanService.previewFulfillmentPlan,
  resolveFulfillmentPlan: fulfillmentPlanService.resolveFulfillmentPlan,
  selectFulfillmentPlan: fulfillmentPlanService.selectFulfillmentPlan,
  confirmFulfillmentPlan: fulfillmentPlanService.confirmFulfillmentPlan,
};

module.exports = publicPort;
