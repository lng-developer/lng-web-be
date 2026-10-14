const { costCenterStatuses, psdStatuses } = require('../constants/orderStatuses');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderRepository = require('../repositories/order.repository');
const orderWorkbenchProjectionService = require('./orderWorkbenchProjection.service');

function getMappingPublic() {
  return require('../../mapping/public');
}

function getCatalogPublic() {
  return require('../../catalog/public');
}

async function loadFulfillmentStatusContext(orderId) {
  const items = await orderItemRepository.listAllByOrder(orderId);
  const orderItemIds = (items || []).map((item) => String(item._id || item.id));
  const plans = orderItemIds.length
    ? await getMappingPublic().listFulfillmentPlansForOrderItems(orderItemIds)
    : [];
  return { items: items || [], orderItemIds, plans: plans || [] };
}

function costCenterStatusFor({ orderItemIds, plans }) {
  const plannedItemIds = new Set((plans || [])
    .filter((plan) => plan && plan.vendorCostCenter)
    .map((plan) => String(plan.orderItemId)));
  return orderItemIds.length > 0 && orderItemIds.every((orderItemId) => plannedItemIds.has(orderItemId))
    ? costCenterStatuses.PRESENT
    : costCenterStatuses.MISSING;
}

async function psdStatusFor({ items, orderItemIds, plans }) {
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
  return orderItemIds.length > 0 && orderItemIds.every((orderItemId) => {
    const plan = planByItemId.get(orderItemId);
    const variant = plan?.listingVariantId && variantById.get(String(plan.listingVariantId));
    if (variant?.psdReadiness) return variant.psdReadiness.status !== psdStatuses.MISSING;
    const item = (items || []).find((candidate) => String(candidate._id || candidate.id) === orderItemId);
    const listingId = plan?.listing?.id || plan?.listingId || item?.listingId;
    return Boolean(listingId && listingById.get(String(listingId))?.defaultPsdTemplateAssetId);
  })
    ? psdStatuses.PRESENT
    : psdStatuses.MISSING;
}

async function updateCostCenterStatusForOrder(orderId) {
  const context = await loadFulfillmentStatusContext(orderId);
  const status = costCenterStatusFor(context);

  const updated = await orderRepository.updateCostCenterStatus(orderId, status);
  await orderWorkbenchProjectionService.updateOrderWorkbenchOrder(orderId, {
    costCenterStatus: status,
    'order.costCenterStatus': status,
  });
  return updated;
}

async function updatePsdStatusForOrder(orderId) {
  const context = await loadFulfillmentStatusContext(orderId);
  const status = await psdStatusFor(context);

  const updated = await orderRepository.updatePsdStatus(orderId, status);
  await orderWorkbenchProjectionService.updateOrderWorkbenchOrder(orderId, {
    psdStatus: status,
    'order.psdStatus': status,
    hasCurrentPsd: status === psdStatuses.PRESENT,
  });
  return updated;
}

async function refreshFulfillmentStatusesForOrder(orderId) {
  const context = await loadFulfillmentStatusContext(orderId);
  const costCenterStatus = costCenterStatusFor(context);
  const psdStatus = await psdStatusFor(context);
  const [order] = await Promise.all([
    orderRepository.updateCostCenterStatus(orderId, costCenterStatus),
    orderRepository.updatePsdStatus(orderId, psdStatus),
    orderWorkbenchProjectionService.updateOrderWorkbenchOrder(orderId, {
      costCenterStatus,
      'order.costCenterStatus': costCenterStatus,
      psdStatus,
      'order.psdStatus': psdStatus,
      hasCurrentPsd: psdStatus === psdStatuses.PRESENT,
    }),
  ]);
  return order;
}

async function updatePsdStatusesForListing(listingId) {
  const orderIds = await orderItemRepository.listOrderIdsByListingId(listingId);
  return Promise.all(orderIds.map((orderId) => updatePsdStatusForOrder(orderId)));
}

module.exports = {
  updateCostCenterStatusForOrder,
  updatePsdStatusForOrder,
  refreshFulfillmentStatusesForOrder,
  updatePsdStatusesForListing,
};
