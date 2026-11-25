const mappingPublic = require('../../mapping/public');
const financeImports = require('../repositories/financeImport.repository');
const orderPublic = require('../../order/public');
const repository = require('../repositories/financeSnapshot.repository');

const config = require('../../../config');
const requests = require('../repositories/financeRecalculationRequest.repository');

const refreshCheckpoint = 'rolling-snapshot-refresh';
const refreshAgeMs = 7 * 24 * 60 * 60 * 1000;

async function refreshAgedSnapshots(pageSize = 100) {
  const cursor = await requests.checkpoint(refreshCheckpoint);
  const itemIds = await orderPublic.pageItemIds(cursor, pageSize);
  const [snapshots, items, financialInputs, plans] = await Promise.all([
    repository.listCalculationTimes(itemIds),
    orderPublic.findItemsByIds(itemIds),
    financeImports.latestFinancialInputTimes(itemIds),
    mappingPublic.listFulfillmentPlansForOrderItems(itemIds, { system: true }),
  ]);
  const calculated = new Map(snapshots.map((row) => [String(row.orderItemId), row.calculatedAt]));
  const changed = new Set([...financialInputs, ...plans]
    .filter((row) => row.updatedAt > calculated.get(String(row.orderItemId)))
    .map((row) => String(row.orderItemId)));
  const oldest = Date.now() - refreshAgeMs;
  for (const item of items) {
    const orderItemId = String(item._id);
    const calculatedAt = calculated.get(orderItemId);
    // Shipment tracking, seller dimensions, and source deletions lack a shared revision.
    if (!calculatedAt || item.updatedAt > calculatedAt || changed.has(orderItemId) || calculatedAt <= oldest) {
      await requests.request({ orderItemId, reason: 'ROLLING_RECONCILIATION' }, { refresh: true });
    }
  }
  const next = itemIds.length === pageSize ? String(itemIds[itemIds.length - 1]) : null;
  await requests.advanceCheckpoint(cursor, next, refreshCheckpoint);
}

async function reconcileSnapshots({ limit = 100, dryRun = true } = {}) {
  const { enqueueSnapshotRecalculation } = require('./financeSnapshotQueue.service');
  const durable = config.finance?.durableRecalculationEnabled;
  const pageSize = Math.min(1000, Math.max(1, Math.trunc(limit) || 100));
  const cursor = durable ? await requests.checkpoint() : null;
  const itemIds = durable
    ? await orderPublic.pageItemIds(cursor, pageSize)
    : (await orderPublic.findItemIds({})).slice(0, limit);
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
      if (queued.queued || queued.persisted) result.queued += 1;
      else result.failed += 1;
    } catch (_error) { result.failed += 1; }
  }
  if (durable && !result.failed) {
    const next = itemIds.length === pageSize ? String(itemIds[itemIds.length - 1]) : null;
    await requests.advanceCheckpoint(cursor, next);
  }
  return result;
}

module.exports = { reconcileSnapshots, refreshAgedSnapshots };
