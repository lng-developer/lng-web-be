const fulfillmentPlanService = require('./services/fulfillmentPlan.service');
const mappingRuleService = require('./services/mappingRule.service');
const fulfillmentPlanRepository = require('./repositories/fulfillmentPlan.repository');

const publicPort = {
  getFulfillmentPlanForOrderItem: fulfillmentPlanService.getFulfillmentPlanForOrderItem,
  listFulfillmentPlansForOrderItems: fulfillmentPlanService.listFulfillmentPlansForOrderItems,
  previewFulfillmentPlan: fulfillmentPlanService.previewFulfillmentPlan,
  previewRule: mappingRuleService.previewRule,
  normalizeSkuForContext: mappingRuleService.normalizeSkuForContext,
  resolveFulfillmentPlan: fulfillmentPlanService.resolveFulfillmentPlan,
  recheckFulfillmentPlan: fulfillmentPlanService.recheckFulfillmentPlan,
  recheckBlockedFulfillmentPlansForListingVariant: fulfillmentPlanService.recheckBlockedFulfillmentPlansForListingVariant,
  searchVendorCandidatesForOrderItem: fulfillmentPlanService.searchVendorCandidatesForOrderItem,
  selectFulfillmentPlan: fulfillmentPlanService.selectFulfillmentPlan,
  findRuleConflicts: mappingRuleService.findRuleConflicts,
  listAuthorableShops: mappingRuleService.listAuthorableShops,
  listRuleHistory: mappingRuleService.listRuleHistory,
  listFulfillmentPlansByOrderItemIds: fulfillmentPlanService.listFulfillmentPlansByOrderItemIds,
  listFulfillmentPlansByListingId: fulfillmentPlanRepository.listByListingId,
  relinkFulfillmentPlansForCatalogMerge: fulfillmentPlanRepository.relinkPlansForCatalogMerge,
};

module.exports = publicPort;
