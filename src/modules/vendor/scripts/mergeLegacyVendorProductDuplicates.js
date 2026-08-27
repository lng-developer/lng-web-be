const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');

function idOf(value) {
  return String(value?._id || value || '');
}

function buildMergePlan({ products = [], costCenters = [] } = {}) {
  const productsByLegacyId = new Map();
  for (const product of products) {
    const legacyId = product.metadata?.legacyId;
    if (!legacyId) continue;
    productsByLegacyId.set(String(legacyId), [...(productsByLegacyId.get(String(legacyId)) || []), product]);
  }

  const pairs = [];
  for (const rows of productsByLegacyId.values()) {
    if (rows.length < 2) continue;
    const canonical = rows.filter((row) => String(row.code).startsWith('PRODUCT_'));
    if (canonical.length !== 1 || new Set(rows.map((row) => idOf(row.vendorId))).size !== 1) {
      throw new Error(`Cannot select a canonical product for legacy ID ${rows[0].metadata.legacyId}`);
    }
    rows.filter((row) => idOf(row) !== idOf(canonical[0])).forEach((row) => {
      pairs.push({ canonicalProductId: idOf(canonical[0]), duplicateProductId: idOf(row) });
    });
  }

  const costCentersByProductId = new Map();
  for (const costCenter of costCenters) {
    const productId = idOf(costCenter.vendorProductId);
    costCentersByProductId.set(productId, [...(costCentersByProductId.get(productId) || []), costCenter]);
  }

  const costCenterMoves = [];
  const codeConflicts = [];
  for (const pair of pairs) {
    const occupiedCodes = new Set((costCentersByProductId.get(pair.canonicalProductId) || []).map((row) => row.code));
    for (const costCenter of costCentersByProductId.get(pair.duplicateProductId) || []) {
      if (occupiedCodes.has(costCenter.code)) {
        codeConflicts.push({ ...pair, code: costCenter.code });
        continue;
      }
      occupiedCodes.add(costCenter.code);
      costCenterMoves.push({ costCenterId: idOf(costCenter), vendorProductId: pair.canonicalProductId });
    }
  }

  return { pairs, costCenterMoves, codeConflicts };
}

function chunks(rows, size = 500) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

async function audit({ collections }) {
  const products = await collections.vendorProducts.find({ 'metadata.legacyId': { $type: 'string' } }).toArray();
  const legacyGroups = new Map();
  products.forEach((product) => {
    const legacyId = String(product.metadata.legacyId);
    legacyGroups.set(legacyId, [...(legacyGroups.get(legacyId) || []), product]);
  });
  const duplicateIds = [...legacyGroups.values()].filter((rows) => rows.length > 1).flat().map((row) => row._id);
  const costCenters = duplicateIds.length
    ? await collections.vendorCostCenters.find({ vendorProductId: { $in: duplicateIds } }).toArray()
    : [];
  const plan = buildMergePlan({ products, costCenters });
  const duplicateObjectIds = plan.pairs.map((pair) => new mongoose.Types.ObjectId(pair.duplicateProductId));
  const duplicateStrings = duplicateObjectIds.map(String);
  const [fulfillmentPlans, vendorSubmissions, financeSnapshots, productionTasks] = await Promise.all([
    collections.fulfillmentPlans.countDocuments({ vendorProductId: { $in: duplicateObjectIds } }),
    collections.vendorSubmissions.countDocuments({ vendorProductId: { $in: duplicateObjectIds } }),
    collections.financeSnapshots.countDocuments({ vendorProductId: { $in: duplicateObjectIds } }),
    collections.productionTasks.countDocuments({ vendorProductId: { $in: duplicateStrings } }),
  ]);
  return { ...plan, references: { fulfillmentPlans, vendorSubmissions, financeSnapshots, productionTasks } };
}

async function apply({ collections, plan }) {
  if (plan.codeConflicts.length) throw new Error('Apply blocked: cost center code conflicts found');
  if (plan.references.vendorSubmissions || plan.references.financeSnapshots || plan.references.productionTasks) {
    throw new Error('Apply blocked: historical references found');
  }

  for (const batch of chunks(plan.costCenterMoves)) {
    await collections.vendorCostCenters.bulkWrite(batch.map((move) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(move.costCenterId) },
        update: { $set: { vendorProductId: new mongoose.Types.ObjectId(move.vendorProductId), updatedAt: new Date() } },
      },
    })));
  }
  for (const pair of plan.pairs) {
    await collections.fulfillmentPlans.updateMany(
      { vendorProductId: new mongoose.Types.ObjectId(pair.duplicateProductId) },
      { $set: { vendorProductId: new mongoose.Types.ObjectId(pair.canonicalProductId), updatedAt: new Date() } },
    );
  }
  const deleted = await collections.vendorProducts.deleteMany({
    _id: { $in: plan.pairs.map((pair) => new mongoose.Types.ObjectId(pair.duplicateProductId)) },
  });
  if (deleted.deletedCount !== plan.pairs.length) throw new Error(`Expected to delete ${plan.pairs.length} duplicate products, deleted ${deleted.deletedCount}`);
  return { movedCostCenters: plan.costCenterMoves.length, deletedProducts: deleted.deletedCount, rewrittenFulfillmentPlans: plan.references.fulfillmentPlans };
}

async function runCli() {
  await connectDatabase();
  try {
    const db = mongoose.connection.db;
    const collections = {
      vendorProducts: db.collection('vendorproducts'), vendorCostCenters: db.collection('vendorcostcenters'),
      fulfillmentPlans: db.collection('fulfillmentplans'), vendorSubmissions: db.collection('vendorsubmissions'),
      financeSnapshots: db.collection('financesnapshots'), productionTasks: db.collection('productiontasks'),
    };
    const plan = await audit({ collections });
    if (!process.argv.includes('--apply')) {
      process.stdout.write(`${JSON.stringify({ database: db.databaseName, pairs: plan.pairs.length, costCenterMoves: plan.costCenterMoves.length, codeConflicts: plan.codeConflicts.length, references: plan.references }, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(await apply({ collections, plan }), null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) runCli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { buildMergePlan, audit, apply };
