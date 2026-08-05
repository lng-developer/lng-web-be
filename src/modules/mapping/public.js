const fulfillmentPlanService = require('./services/fulfillmentPlan.service');
const mappingRuleService = require('./services/mappingRule.service');

const publicPort = {
  getFulfillmentPlanForOrderItem: fulfillmentPlanService.getFulfillmentPlanForOrderItem,
  listFulfillmentPlansForOrderItems: fulfillmentPlanService.listFulfillmentPlansForOrderItems,
  previewFulfillmentPlan: fulfillmentPlanService.previewFulfillmentPlan,
  previewRule: mappingRuleService.previewRule,
  resolveFulfillmentPlan: fulfillmentPlanService.resolveFulfillmentPlan,
  recheckFulfillmentPlan: fulfillmentPlanService.recheckFulfillmentPlan,
  searchVendorCandidatesForOrderItem: fulfillmentPlanService.searchVendorCandidatesForOrderItem,
  selectFulfillmentPlan: fulfillmentPlanService.selectFulfillmentPlan,
  findRuleConflicts: mappingRuleService.findRuleConflicts,
  listAuthorableShops: mappingRuleService.listAuthorableShops,
  listRuleHistory: mappingRuleService.listRuleHistory,
  listFulfillmentPlansByOrderItemIds: fulfillmentPlanService.listFulfillmentPlansByOrderItemIds,
};

module.exports = publicPort;
