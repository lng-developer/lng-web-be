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
  findItemById: orderItemRepository.findById,
  transitionItemStatus: orderItemStatusTransitionService.transitionItemStatus,
  updateItemStatus: orderItemStatusTransitionService.transitionItemStatus,
  updateItemExternalItemId: orderItemRepository.updateExternalItemId,
  updateItemAsin: orderItemRepository.updateAsin,
  appendTimeline: orderTimelineService.appendTimeline,
  validateAddress: orderAddressValidationService.validateAddress,
  updateShippingAddress: orderAddressValidationService.updateShippingAddress,
  markFulfillmentReady: orderReadinessService.markFulfillmentReady,
  updateCostCenterStatusForOrder: orderCostCenterStatusService.updateCostCenterStatusForOrder,
  listTimelineByOrder: orderTimelineService.listByOrder,
  listTimelineByOrderItem: orderTimelineService.listByOrderItem,
};

module.exports = publicPort;
