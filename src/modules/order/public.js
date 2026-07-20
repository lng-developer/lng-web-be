const orderImportService = require('./services/orderImport.service');
const orderRepository = require('./repositories/order.repository');
const orderItemRepository = require('./repositories/orderItem.repository');
const orderTimelineService = require('./services/orderTimeline.service');
const orderAddressValidationService = require('./services/orderAddressValidation.service');
const orderReadinessService = require('./services/orderReadiness.service');
const orderCostCenterStatusService = require('./services/orderCostCenterStatus.service');
const orderItemStatusTransitionService = require('./services/orderItemStatusTransition.service');
const orderWorkflowService = require('./services/orderWorkflow.service');
const { addressValidationStatuses } = require('./constants/orderStatuses');

const publicPort = {
  importExternalOrder: orderImportService.importExternalOrder,
  findById: orderRepository.findById,
  findByExternalIdentity: orderRepository.findByExternalIdentity,
  findItemById: orderItemRepository.findById,
  findItemByFinanceIdentity: orderItemRepository.findByFinanceIdentity,
  listItems: orderItemRepository.list,
  listItemsByOrder: orderItemRepository.listAllByOrder,
  summarizeOrderItems: orderItemRepository.summarize,
  summarizeSalesByListingIds: orderItemRepository.summarizeSalesByListingIds,
  transitionItemStatus: orderItemStatusTransitionService.transitionItemStatus,
  updateItemStatus: orderItemStatusTransitionService.transitionItemStatus,
  markOrderDelivered: orderItemStatusTransitionService.markOrderDelivered,
  updateItemExternalItemId: orderItemRepository.updateExternalItemId,
  updateItemAsin: orderItemRepository.updateAsin,
  updateItemListingId: orderItemRepository.updateListingId,
  appendTimeline: orderTimelineService.appendTimeline,
  appendTimelineOnce: orderTimelineService.appendTimelineOnce,
  validateAddress: orderAddressValidationService.validateAddress,
  updateShippingAddress: orderAddressValidationService.updateShippingAddress,
  markFulfillmentReady: orderReadinessService.markFulfillmentReady,
  updateCostCenterStatusForOrder: orderCostCenterStatusService.updateCostCenterStatusForOrder,
  updatePsdStatusForOrder: orderCostCenterStatusService.updatePsdStatusForOrder,
  updatePsdStatusesForListing: orderCostCenterStatusService.updatePsdStatusesForListing,
  listTimelineByOrder: orderTimelineService.listByOrder,
  listTimelineByOrderItem: orderTimelineService.listByOrderItem,
  deriveOrderItemWorkflow: orderWorkflowService.deriveOrderItemWorkflow,
  addressValidationStatuses,
};

module.exports = publicPort;
