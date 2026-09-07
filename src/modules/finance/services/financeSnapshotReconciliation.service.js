const orderPublic = require('../../order/public');
const repository = require('../repositories/financeSnapshot.repository');
const { enqueueSnapshotRecalculation } = require('./financeSnapshotQueue.service');

async function reconcileSnapshots({ limit = 100, dryRun = true } = {}) {
  const itemIds = (await orderPublic.findItemIds({})).slice(0, limit);
  const snapshots = await repository.listByOrderItemIds(itemIds);
  const existing = new Set(snapshots.map((snapshot) => String(snapshot.orderItemId)));
  const missing = itemIds.filter((orderItemId) => !existing.has(String(orderItemId)));
  const result = { checked: itemIds.length, eligible: missing.length, queued: 0, failed: 0, dryRun };
  if (dryRun) return result;
  for (const orderItemId of missing) {
    try {
      const queued = await enqueueSnapshotRecalculation({
        orderItemId: String(orderItemId), reason: 'RECONCILIATION_MISSING',
      });
      if (queued.queued) result.queued += 1;
      else result.failed += 1;
    } catch (_error) { result.failed += 1; }
  }
  return result;
}

module.exports = { reconcileSnapshots };
