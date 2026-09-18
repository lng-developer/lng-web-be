const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const OrderRecheckJob = require('../models/orderRecheckJob.model');

const key = { activeKey: 1 };
const partialFilterExpression = { activeKey: { $type: 'string' } };
const same = (left, right) => JSON.stringify(left || {}) === JSON.stringify(right || {});

function buildMigrationPlan(indexes = []) {
  const matching = indexes.filter((index) => same(index.key, key));
  const current = matching.find((index) => index.unique === true && same(index.partialFilterExpression, partialFilterExpression));
  if (current) return { status: 'UP_TO_DATE', dropIndexes: matching.filter((index) => index.name !== current.name).map((index) => index.name) };
  return { status: 'NEEDS_MIGRATION', dropIndexes: matching.map((index) => index.name), createIndex: true };
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectDatabase();
  try {
    const plan = buildMigrationPlan(await OrderRecheckJob.collection.indexes());
    console.log(JSON.stringify({ ...plan, mode: apply ? 'APPLY' : 'DRY_RUN' }));
    if (!apply || plan.status === 'UP_TO_DATE') return;
    for (const indexName of plan.dropIndexes) await OrderRecheckJob.collection.dropIndex(indexName);
    await OrderRecheckJob.collection.createIndex(key, { unique: true, partialFilterExpression });
    console.log(JSON.stringify({ status: 'APPLIED' }));
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { buildMigrationPlan };
