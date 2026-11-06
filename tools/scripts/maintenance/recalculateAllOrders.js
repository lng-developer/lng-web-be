'use strict';

const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const mappingPublic = require('../../../src/modules/mapping/public');
const financePublic = require('../../../src/modules/finance/public');

const authContext = {
  system: true,
  source: 'ORDER_RECALCULATION_BATCH',
  permissions: ['FINANCE:WRITE', 'FINANCE:READ', 'MAPPING:WRITE', 'ORDER:WRITE'],
};

function parseArgs(args = []) {
  const options = {
    apply: false,
    includeCancelled: false,
  };

  for (const arg of args) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--include-cancelled') {
      options.includeCancelled = true;
    }
  }

  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  console.log('='.repeat(60));
  console.log(' RECALCULATE ORDERS & FULFILLMENT PLANS SCRIPT');
  console.log('='.repeat(60));
  console.log(` Mode:               ${options.apply ? 'APPLY (LIVE RECALCULATION)' : 'DRY-RUN (SIMULATION ONLY)'}`);
  console.log(` Include Cancelled:  ${options.includeCancelled}`);

  await connectDatabase();
  const db = mongoose.connection.db;
  console.log(` Target DB:          ${db.databaseName}`);
  console.log('='.repeat(60));

  const matchFilter = options.includeCancelled
    ? {}
    : { 'order.status': { $ne: 'CANCELLED' } };

  const items = await db.collection('orderitems').aggregate([
    {
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'order',
      },
    },
    { $unwind: '$order' },
    { $match: matchFilter },
    {
      $project: {
        _id: 1,
        sku: 1,
        status: 1,
        orderId: 1,
        'order.externalOrderId': 1,
        'order.status': 1,
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray();

  console.log(`\nFound ${items.length} order item(s) to recalculate.`);

  const summary = {
    total: items.length,
    planRechecked: 0,
    financeRecalculated: 0,
    errors: [],
  };

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const itemId = String(item._id);
    const orderRef = item.order?.externalOrderId || String(item.orderId);

    console.log(`[${i + 1}/${items.length}] Processing order ${orderRef} (Item: ${itemId}, SKU: ${item.sku || 'N/A'})...`);

    if (!options.apply) {
      summary.planRechecked += 1;
      summary.financeRecalculated += 1;
      continue;
    }

    try {
      await mappingPublic.recheckFulfillmentPlan(itemId, {}, authContext);
      summary.planRechecked += 1;
    } catch (error) {
      console.warn(`  ⚠️ Mapping recheck warning for ${itemId}: ${error.message}`);
    }

    try {
      await financePublic.recalculateOrderItem(itemId, authContext, {});
      summary.financeRecalculated += 1;
    } catch (error) {
      console.error(`  ❌ Finance recalculation error for ${itemId}: ${error.message}`);
      summary.errors.push({ itemId, orderRef, error: error.message });
    }
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(60));
  console.log(' RECALCULATION SUMMARY');
  console.log('='.repeat(60));
  console.log(` Target DB:             ${db.databaseName}`);
  console.log(` Status:                ${options.apply ? 'COMPLETED' : 'DRY-RUN COMPLETE'}`);
  console.log(` Total Order Items:     ${summary.total}`);
  console.log(` Plans Rechecked:       ${summary.planRechecked}`);
  console.log(` Finance Recalculated:  ${summary.financeRecalculated}`);
  console.log(` Errors:                ${summary.errors.length}`);
  console.log(` Duration:              ${durationSec}s`);
  console.log('='.repeat(60));

  if (!options.apply) {
    console.log('\n💡 Tip: To apply recalculation across these orders, run:');
    console.log('   node tools/scripts/maintenance/recalculateAllOrders.js --apply\n');
  }
}

run()
  .catch((error) => {
    console.error('Recalculation script failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
