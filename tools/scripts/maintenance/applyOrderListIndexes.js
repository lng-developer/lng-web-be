const mongoose = require('mongoose');
const { hasCompatibleOptions } = require('../audit/mongoIndexAudit');

const indexes = [
  { collection: 'productiontasks', key: { updatedAt: -1 }, name: 'updatedAt_-1' },
  { collection: 'shipments', key: { updatedAt: -1, _id: -1 }, name: 'updatedAt_-1__id_-1' },
  { collection: 'financesnapshots', key: { calculatedAt: -1, _id: -1 }, name: 'calculatedAt_-1__id_-1' },
  { collection: 'vendorsubmissions', key: { updatedAt: -1, _id: -1 }, name: 'updatedAt_-1__id_-1' },
  { collection: 'financerecalculationrequests', key: { pending: 1, nextSignalAt: 1, _id: 1 }, name: 'pending_1_nextSignalAt_1__id_1' },
  { collection: 'fulfillmentsideeffectrequests', key: { orderId: 1 }, name: 'orderId_1', unique: true },
  { collection: 'fulfillmentsideeffectrequests', key: { blocked: 1, nextAttemptAt: 1, leaseExpiresAt: 1 }, name: 'blocked_1_nextAttemptAt_1_leaseExpiresAt_1' },
  { collection: 'refundrecords', key: { 'allocations.orderItemId': 1 }, name: 'finance_refund_allocation_item_idx', sparse: true },
];

function matches(actual, expected) {
  // Compound key order is significant; do not sort the key object.
  return JSON.stringify(Object.entries(actual.key)) === JSON.stringify(Object.entries(expected.key))
    && hasCompatibleOptions(actual, expected) && !actual.hidden;
}

async function applyBatch(db, { database, apply = false, output = process.stdout } = {}) {
  if (!['lng_web_be', 'lng_web_be_develop'].includes(database) || db.databaseName !== database) {
    throw new Error('Refusing index batch: explicit database does not match connected database');
  }
  const plan = [];
  for (const index of indexes) {
    const installed = await db.collection(index.collection).listIndexes().toArray();
    const named = installed.find((entry) => entry.name === index.name);
    if (named && !matches(named, index)) throw new Error(`Index definition conflict: ${index.collection}.${index.name}`);
    if (installed.some((entry) => JSON.stringify(Object.entries(entry.key)) === JSON.stringify(Object.entries(index.key)) && !matches(entry, index))) {
      throw new Error(`Index options conflict: ${index.collection}.${index.name}`);
    }
    const existing = installed.find((entry) => matches(entry, index))?.name;
    if (index.unique && !existing) {
      const duplicates = await db.collection(index.collection).aggregate([
        { $group: { _id: Object.fromEntries(Object.keys(index.key).map((field) => [field, { $ifNull: [`$${field}`, null] }])), count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }, { $limit: 1 },
      ], { maxTimeMS: 10000 }).toArray();
      if (duplicates.length) throw new Error(`Duplicate data blocks unique index: ${index.collection}.${index.name}`);
    }
    plan.push({ index, existing });
  }
  output.write(`${JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', database })}\n`);
  const results = [];
  for (const { index, existing } of plan) {
    const { collection, key, ...options } = index;
    let result = { collection, name: existing || index.name, status: existing ? 'EXISTS' : 'PLANNED' };
    if (apply && !existing) {
      const created = await db.command({ createIndexes: collection, indexes: [{ key, ...options }] });
      result = created.numIndexesAfter > created.numIndexesBefore
        ? { ...result, status: 'CREATED', rollback: `db.getSiblingDB(${JSON.stringify(database)}).getCollection(${JSON.stringify(collection)}).dropIndex(${JSON.stringify(index.name)})` }
        : { ...result, status: 'EXISTS' };
    }
    results.push(result);
    output.write(`${JSON.stringify(result)}\n`);
  }
  return results;
}

async function main(argv = process.argv.slice(2)) {
  const allowed = argv.every((arg) => arg === '--apply' || /^--database=(lng_web_be|lng_web_be_develop)$/.test(arg));
  const targets = argv.filter((arg) => arg.startsWith('--database='));
  if (!allowed || targets.length !== 1) throw new Error('Usage: node applyOrderListIndexes.js --database=<exact-name> [--apply]');
  const config = require('../../../src/config');
  try {
    await mongoose.connect(config.database.uri, { autoIndex: false, autoCreate: false });
    await applyBatch(mongoose.connection.db, { database: targets[0].slice('--database='.length), apply: argv.includes('--apply') });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { indexes, matches, applyBatch };
