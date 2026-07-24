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
  const listingIdsByItemId = new Map((items || []).map((item) => {
    const itemId = String(item._id || item.id);
    const planListingId = planByItemId.get(itemId)?.listing?.id;
    const listingId = item.listingId || planListingId || null;
    return [itemId, listingId ? String(listingId) : null];
  }));
  const listingIds = [...new Set([...listingIdsByItemId.values()].filter(Boolean))];
  const listings = listingIds.length ? await getCatalogPublic().getListingSummariesByIds(listingIds) : [];
  const listingById = new Map((listings || []).map((listing) => [String(listing._id || listing.id), listing]));
  const status = orderItemIds.length > 0 && orderItemIds.every((orderItemId) => {
    const listingId = listingIdsByItemId.get(orderItemId);
    const readiness = listingId && listingById.get(listingId)?.psdReadiness;
    if (readiness) return readiness.status !== psdStatuses.MISSING;
    return listingId && listingById.get(listingId)?.psdStatus === psdStatuses.PRESENT;
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
