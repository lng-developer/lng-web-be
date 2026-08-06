const { costCenterStatuses, psdStatuses } = require('../constants/orderStatuses');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderRepository = require('../repositories/order.repository');

function getMappingPublic() {
  return require('../../mapping/public');
}

function getCatalogPublic() {
  return require('../../catalog/public');
}

async function updateCostCenterStatusForOrder(orderId) {
  const items = await orderItemRepository.listAllByOrder(orderId);
  const orderItemIds = (items || []).map((item) => String(item._id || item.id));
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

async function updatePsdStatusForOrder(orderId) {
  const items = await orderItemRepository.listAllByOrder(orderId);
  const orderItemIds = (items || []).map((item) => String(item._id || item.id));
  const plans = orderItemIds.length
    ? await getMappingPublic().listFulfillmentPlansForOrderItems(orderItemIds)
    : [];
  const planByItemId = new Map((plans || []).map((plan) => [String(plan.orderItemId), plan]));
  const variantIds = [...new Set((plans || []).map((plan) => plan.listingVariantId).filter(Boolean).map(String))];
  const variants = await Promise.all(variantIds.map((variantId) => getCatalogPublic().getListingVariantById(variantId)));
  const variantById = new Map(variants.filter(Boolean).map((variant) => [String(variant.id || variant._id), variant]));
  const status = orderItemIds.length > 0 && orderItemIds.every((orderItemId) => {
    const plan = planByItemId.get(orderItemId);
    const variant = plan?.listingVariantId && variantById.get(String(plan.listingVariantId));
    if (variant?.psdReadiness) return variant.psdReadiness.status !== psdStatuses.MISSING;
    return false;
  })
    ? psdStatuses.PRESENT
    : psdStatuses.MISSING;

  return orderRepository.updatePsdStatus(orderId, status);
}

async function updatePsdStatusesForListing(listingId) {
  const orderIds = await orderItemRepository.listOrderIdsByListingId(listingId);
  return Promise.all(orderIds.map((orderId) => updatePsdStatusForOrder(orderId)));
}

module.exports = {
  updateCostCenterStatusForOrder,
  updatePsdStatusForOrder,
  updatePsdStatusesForListing,
};
