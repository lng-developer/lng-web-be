const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const financePublic = require('../../../src/modules/finance/public');

const apply = process.argv.includes('--apply');
const authContext = {
  system: true,
  source: 'FINANCE_SNAPSHOT_BACKFILL',
  permissions: ['FINANCE:WRITE', 'FINANCE:READ'],
};

async function run() {
  await connectDatabase();
  const db = mongoose.connection.db;
  const summary = {
    apply,
    database: db.databaseName,
    scanned: 0,
    recalculated: 0,
    failed: 0,
    failures: [],
  };

  const cursor = db.collection('orderitems').find({}, { projection: { _id: 1 } }).sort({ _id: 1 });
  for await (const item of cursor) {
    summary.scanned += 1;
    if (!apply) continue;
    try {
      await financePublic.recalculateOrderItem(String(item._id), authContext, {});
      summary.recalculated += 1;
    } catch (error) {
      summary.failed += 1;
      if (summary.failures.length < 10) {
        summary.failures.push({ orderItemId: String(item._id), message: error.message });
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
