const orderImportService = require('./services/orderImport.service');
const orderRepository = require('./repositories/order.repository');
const orderItemRepository = require('./repositories/orderItem.repository');
const orderTimelineService = require('./services/orderTimeline.service');
const orderAddressValidationService = require('./services/orderAddressValidation.service');
const orderReadinessService = require('./services/orderReadiness.service');
const orderCostCenterStatusService = require('./services/orderCostCenterStatus.service');
const orderItemStatusTransitionService = require('./services/orderItemStatusTransition.service');

const publicPort = {
  importExternalOrder: orderImportService.importExternalOrder,
  findById: orderRepository.findById,
  findByExternalIdentity: orderRepository.findByExternalIdentity,
  findItemById: orderItemRepository.findById,
  findItemByFinanceIdentity: orderItemRepository.findByFinanceIdentity,
  listItems: orderItemRepository.list,
  listItemsByOrder: orderItemRepository.listAllByOrder,
  summarizeOrderItems: orderItemRepository.summarize,
  transitionItemStatus: orderItemStatusTransitionService.transitionItemStatus,
  updateItemStatus: orderItemStatusTransitionService.transitionItemStatus,
  markOrderDelivered: orderItemStatusTransitionService.markOrderDelivered,
  updateItemExternalItemId: orderItemRepository.updateExternalItemId,
  updateItemAsin: orderItemRepository.updateAsin,
  appendTimeline: orderTimelineService.appendTimeline,
  validateAddress: orderAddressValidationService.validateAddress,
  updateShippingAddress: orderAddressValidationService.updateShippingAddress,
  markFulfillmentReady: orderReadinessService.markFulfillmentReady,
  updateCostCenterStatusForOrder: orderCostCenterStatusService.updateCostCenterStatusForOrder,
  updatePsdStatusForOrder: orderCostCenterStatusService.updatePsdStatusForOrder,
  listTimelineByOrder: orderTimelineService.listByOrder,
  listTimelineByOrderItem: orderTimelineService.listByOrderItem,
};

module.exports = publicPort;
