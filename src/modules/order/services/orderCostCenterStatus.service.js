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
  const listingIds = [...new Set([
    ...(items || []).map((item) => item.listingId).filter(Boolean).map(String),
    ...(plans || []).map((plan) => plan.listing?.id || plan.listingId).filter(Boolean).map(String),
  ])];
  const [variants, listings] = await Promise.all([
    Promise.all(variantIds.map((variantId) => getCatalogPublic().getListingVariantById(variantId))),
    listingIds.length ? getCatalogPublic().getListingSummariesByIds(listingIds) : [],
  ]);
  const variantById = new Map(variants.filter(Boolean).map((variant) => [String(variant.id || variant._id), variant]));
  const listingById = new Map((listings || []).filter(Boolean).map((listing) => [String(listing.id || listing._id), listing]));
  const status = orderItemIds.length > 0 && orderItemIds.every((orderItemId) => {
    const plan = planByItemId.get(orderItemId);
    const variant = plan?.listingVariantId && variantById.get(String(plan.listingVariantId));
    if (variant?.psdReadiness) return variant.psdReadiness.status !== psdStatuses.MISSING;
    const item = (items || []).find((candidate) => String(candidate._id || candidate.id) === orderItemId);
    const listingId = plan?.listing?.id || plan?.listingId || item?.listingId;
    const listing = listingId && listingById.get(String(listingId));
    if (listing?.defaultPsdTemplateAssetId) return true;
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
