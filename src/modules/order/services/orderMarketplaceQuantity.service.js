const items = require('../repositories/orderItem.repository');
const timeline = require('../repositories/orderTimeline.repository');

function validQuantity(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function resolveMarketplaceQuantities(orderItems, { session } = {}) {
  // Persisted null means unknown; later manual-edit history must not become evidence of the original.
  const legacy = orderItems.filter((item) => item.marketplaceQuantity === undefined && item.quantityOverride != null);
  const events = legacy.length ? await timeline.listQuantityUpdates(legacy.map((item) => item._id), { session }) : [];
  const originals = new Map();
  for (const event of events) {
    const id = String(event.orderItemId);
    if (!originals.has(id)) originals.set(id, validQuantity(event.metadata?.previousQuantity));
  }
  return orderItems.map((item) => ({
    ...item,
    marketplaceQuantity: item.marketplaceQuantity !== undefined
      ? validQuantity(item.marketplaceQuantity)
      : item.quantityOverride == null ? validQuantity(item.quantity) : originals.get(String(item._id)) ?? null,
  }));
}

async function findItemsForMarketplaceConfirmation(ids = []) {
  return resolveMarketplaceQuantities(await items.findByIds(ids));
}

module.exports = { resolveMarketplaceQuantities, findItemsForMarketplaceConfirmation };
