const fulfillmentPlanService = require('./services/fulfillmentPlan.service');

const publicPort = {
  getFulfillmentPlanForOrderItem: fulfillmentPlanService.getFulfillmentPlanForOrderItem,
  listFulfillmentPlansForOrderItems: fulfillmentPlanService.listFulfillmentPlansForOrderItems,
  previewFulfillmentPlan: fulfillmentPlanService.previewFulfillmentPlan,
  resolveFulfillmentPlan: fulfillmentPlanService.resolveFulfillmentPlan,
  searchVendorCandidatesForOrderItem: fulfillmentPlanService.searchVendorCandidatesForOrderItem,
  selectFulfillmentPlan: fulfillmentPlanService.selectFulfillmentPlan,
  confirmFulfillmentPlan: fulfillmentPlanService.confirmFulfillmentPlan,
  listFulfillmentPlansByOrderItemIds: fulfillmentPlanService.listFulfillmentPlansByOrderItemIds,
};

module.exports = publicPort;
