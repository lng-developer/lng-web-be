const { costCenterStatuses } = require('../constants/orderStatuses');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderRepository = require('../repositories/order.repository');

function getMappingPublic() {
  return require('../../mapping/public');
}

async function updateCostCenterStatusForOrder(orderId) {
  const itemPage = await orderItemRepository.listByOrder(orderId, { page: 1, limit: 100 });
  const orderItemIds = (itemPage.items || []).map((item) => String(item._id || item.id));
  const plans = orderItemIds.length
    ? await getMappingPublic().listFulfillmentPlansForOrderItems(orderItemIds)
    : [];
  const plannedItemIds = new Set((plans || [])
    .filter((plan) => plan && plan.vendorCostCenter)
    .map((plan) => String(plan.orderItemId)));
  const status = orderItemIds.length > 0 && orderItemIds.every((orderItemId) => plannedItemIds.has(orderItemId))
    ? costCenterStatuses.PRESENT
    : costCenterStatuses.MISSING;

  return orderRepository.updateCostCenterStatus(orderId, status);
}

module.exports = {
  updateCostCenterStatusForOrder,
};
