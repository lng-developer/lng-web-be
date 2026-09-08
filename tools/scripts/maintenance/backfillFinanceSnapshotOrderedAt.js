const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const FinanceSnapshot = require('../../../src/modules/finance/models/financeSnapshot.model');
const Order = require('../../../src/modules/order/models/order.model');

async function backfillOrderedAt({ apply = false } = {}) {
  const summary = {
    apply,
    scanned: 0,
    eligible: 0,
    wouldUpdate: 0,
    updated: 0,
    missingOrder: 0,
    missingOrderDate: 0,
  };
  const cursor = FinanceSnapshot.find({ orderedAt: null })
    .select('_id orderId')
    .lean()
    .cursor();

  for await (const snapshot of cursor) {
    summary.scanned += 1;
    const order = await Order.findById(snapshot.orderId).select('orderedAt').lean();
    if (!order) {
      summary.missingOrder += 1;
      continue;
    }
    if (!order.orderedAt) {
      summary.missingOrderDate += 1;
      continue;
    }
    summary.eligible += 1;
    summary.wouldUpdate += 1;
    if (!apply) continue;
    const result = await FinanceSnapshot.updateOne(
      { _id: snapshot._id, orderedAt: null },
      { $set: { orderedAt: order.orderedAt } },
    );
    summary.updated += result.modifiedCount || 0;
  }

  return summary;
}

async function main() {
  await connectDatabase();
  try {
    console.log(JSON.stringify(await backfillOrderedAt({ apply: process.argv.includes('--apply') }), null, 2));
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { backfillOrderedAt };
