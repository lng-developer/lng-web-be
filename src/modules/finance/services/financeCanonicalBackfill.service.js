const { isDeepStrictEqual } = require('node:util');
const repository = require('../repositories/financeSnapshot.repository');
const vendorPort = require('../../vendorSubmission/public');
const snapshotService = require('./financeSnapshot.service');
const auditPort = require('../../audit/public');
const { calculateSnapshotFinancials, vendorCostFields } = require('./financeCalculation.service');

function validateScope(options) {
  if (!options.expectDatabase || options.database !== options.expectDatabase) throw new Error('Database mismatch');
  if (!/^[A-Z0-9]+$/.test(options.seller || '') || !/^\d{4}-\d{2}-\d{2}$/.test(options.from || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(options.to || '') || options.from > options.to) throw new Error('Explicit seller and valid date range required');
  const from = new Date(`${options.from}T00:00:00+07:00`);
  const until = new Date(new Date(`${options.to}T00:00:00+07:00`).getTime() + 86400000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime())) throw new Error('Invalid date range');
  return { sellerEmployeeCode: options.seller, from, until };
}

async function prepareEntry(snapshot) {
  const entry = { orderId: String(snapshot.orderId), orderItemId: String(snapshot.orderItemId), snapshotId: String(snapshot._id), revision: snapshot.updatedAt || null };
  try {
    const { payload } = await snapshotService.buildSnapshotPayload(snapshot.orderItemId, { system: true });
    const { calculatedAt, calculationHistory, _id, updatedAt, createdAt, ...fresh } = payload;
    void calculatedAt; void calculationHistory; void _id; void updatedAt; void createdAt;
    const source = await vendorPort.previewCostForOrderItem(snapshot.orderItemId);
    if (!source && snapshot.actualVendorSource === 'MANGOTEE_ORDER_RESPONSE') throw new Error('Vendor cost source unavailable');
    const actual = source ? vendorCostFields(source.vendorCost) : {};
    if (snapshot.actualVendorAllocation?.vendorOrderId && actual.actualVendorAllocation?.vendorOrderId
      && snapshot.actualVendorAllocation.vendorOrderId !== actual.actualVendorAllocation.vendorOrderId) throw new Error('Replacement vendor charge needs reconciliation');
    const canonical = calculateSnapshotFinancials({ ...snapshot, ...fresh, ...actual });
    if (['VENDOR_CURRENCY_MISMATCH', 'COST_CURRENCY_MISMATCH'].includes(canonical.missingCostReason)) throw new Error(canonical.missingCostReason);
    const after = { ...fresh, ...actual, ...canonical, grossProfitAmount: canonical.profitBeforeAdsAmount,
      grossMarginBps: canonical.profitBeforeAdsAmount !== null && fresh.customerPaidAmount > 0
        ? Math.round(canonical.profitBeforeAdsAmount / fresh.customerPaidAmount * 10000) : null };
    const before = Object.fromEntries(Object.keys(after).map(key => [key, snapshot[key] ?? null]));
    const changed = !isDeepStrictEqual(JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)));
    return { ...entry, source, before, beforeHistory: snapshot.calculationHistory || [], beforeCalculatedAt: snapshot.calculatedAt || null, after, status: changed ? 'READY' : 'UNCHANGED' };
  } catch (error) {
    return { ...entry, status: 'SKIPPED', reason: error.message };
  }
}

async function runBackfill(options, { save } = {}) {
  const scope = validateScope(options);
  if (options.apply && !save) throw new Error('Durable manifest output required for apply');
  const identity = { database: options.database, seller: options.seller, from: options.from, to: options.to, calculationVersion: 2 };
  const manifest = options.resume || { ...identity, createdAt: new Date().toISOString(), entries: [] };
  if (Object.keys(identity).some(key => manifest[key] !== identity[key])) throw new Error('Resume scope mismatch');
  if (!options.resume) {
    for await (const snapshot of repository.scanCanonicalScope(scope)) manifest.entries.push(await prepareEntry(snapshot));
  }
  if (save) await save(manifest);
  if (options.apply) {
    for (const entry of manifest.entries) {
      if (entry.status === 'APPLYING') {
        const current = await repository.findByOrderItem(entry.orderItemId);
        const revision = current?.updatedAt ? new Date(current.updatedAt).toISOString() : null;
        entry.status = revision === entry.appliedAt ? 'APPLIED'
          : revision === (entry.revision ? new Date(entry.revision).toISOString() : null) ? 'READY' : 'CONFLICT';
        await save(manifest);
      }
      if (entry.status !== 'READY') continue;
      try {
        const source = await vendorPort.previewCostForOrderItem(entry.orderItemId);
        if (JSON.stringify(source) !== JSON.stringify(entry.source)) throw new Error('Vendor source changed since preview');
        entry.appliedAt = new Date().toISOString();
        // Persist the intended revision before the CAS, so a crash can be reconciled safely.
        entry.status = 'APPLYING';
        await save(manifest);
        const result = await snapshotService.withOrderGuard(entry.orderId, async session => {
          const current = await repository.findByOrderItem(entry.orderItemId, { session });
          const checked = current && await prepareEntry(current);
          if (!checked || JSON.stringify(checked.after) !== JSON.stringify(entry.after)) throw new Error('Financial sources changed since preview');
          const applied = await repository.compareAndSetCanonical(entry.snapshotId, entry.revision, {
            ...entry.after, calculatedAt: new Date(entry.appliedAt), updatedAt: new Date(entry.appliedAt),
            calculationHistory: [{ calculatedAt: new Date(entry.appliedAt), calculationVersion: 2,
              snapshotStatus: entry.after.snapshotStatus, costStatus: entry.after.costStatus,
              missingCostReason: entry.after.missingCostReason }, ...(entry.beforeHistory || [])].slice(0, 20),
          }, { session });
          if (applied.modifiedCount === 1) await auditPort.record({ actorType: 'SYSTEM', action: 'FINANCE_CANONICAL_BACKFILL_APPLIED',
            entityType: 'ORDER_ITEM', entityId: entry.orderItemId, outcome: 'SUCCEEDED', source: 'SYSTEM',
            deduplicationKey: `finance-canonical:${entry.snapshotId}:${entry.appliedAt}`,
            metadata: { calculationVersion: 2, before: entry.before, after: entry.after } }, { session });
          return applied;
        });
        entry.status = result.modifiedCount === 1 ? 'APPLIED' : 'CONFLICT';
      } catch (error) {
        entry.status = 'FAILED'; entry.reason = error.message;
      }
      await save(manifest);
    }
  }
  return manifest;
}

async function rollbackBackfill(options, { save } = {}) {
  validateScope(options);
  const manifest = options.resume;
  if (!save || !manifest || manifest.database !== options.database || manifest.seller !== options.seller
    || manifest.from !== options.from || manifest.to !== options.to) throw new Error('Matching rollback manifest required');
  for (const entry of manifest.entries) {
    if (entry.status === 'ROLLING_BACK') {
      const current = await repository.findByOrderItem(entry.orderItemId);
      const revision = current?.updatedAt ? new Date(current.updatedAt).toISOString() : null;
      entry.status = revision === entry.rolledBackAt ? 'ROLLED_BACK'
        : revision === entry.appliedAt ? 'APPLIED' : 'ROLLBACK_CONFLICT';
      await save(manifest);
    }
    if (entry.status !== 'APPLIED') continue;
    entry.status = 'ROLLING_BACK';
    entry.rolledBackAt = new Date().toISOString();
    await save(manifest);
    const result = await snapshotService.withOrderGuard(entry.orderId, async session => {
      const restored = await repository.compareAndSetCanonical(entry.snapshotId, entry.appliedAt, {
        ...entry.before, calculationHistory: entry.beforeHistory || [],
        calculatedAt: entry.beforeCalculatedAt ? new Date(entry.beforeCalculatedAt) : null, updatedAt: new Date(entry.rolledBackAt),
      }, { session });
      if (restored.modifiedCount === 1) await auditPort.record({ actorType: 'SYSTEM', action: 'FINANCE_CANONICAL_BACKFILL_ROLLED_BACK',
        entityType: 'ORDER_ITEM', entityId: entry.orderItemId, outcome: 'SUCCEEDED', source: 'SYSTEM',
        deduplicationKey: `finance-canonical-rollback:${entry.snapshotId}:${entry.rolledBackAt}`,
        metadata: { appliedAt: entry.appliedAt, restored: entry.before } }, { session });
      return restored;
    });
    entry.status = result.modifiedCount === 1 ? 'ROLLED_BACK' : 'ROLLBACK_CONFLICT';
    await save(manifest);
  }
  return manifest;
}

module.exports = { runBackfill, rollbackBackfill, prepareEntry, validateScope };
