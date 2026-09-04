const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const orderQueryService = require('../services/orderQuery.service');
const projectionService = require('../services/orderWorkbenchProjection.service');
const OrderWorkbenchProjection = require('../models/orderWorkbenchProjection.model');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((result, arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return { ...result, [key]: value };
  }, {});
}

async function backfillOrderWorkbenchProjections({ apply = false, batchSize = 5 } = {}) {
  if (process.env.ORDER_WORKBENCH_PROJECTION_READ === 'true') {
    throw new Error('Disable ORDER_WORKBENCH_PROJECTION_READ before backfilling projections');
  }

  const size = Math.min(Math.max(Number(batchSize) || 5, 1), 100);
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    apply,
    total: 0,
    processed: 0,
    verified: 0,
    failures: [],
  };
  const authContext = { system: true, permissions: ['ORDERS:READ'], source: 'ORDER_WORKBENCH_BACKFILL' };

  for (let page = 1; ; page += 1) {
    const result = await orderQueryService.listOrderWorkbench({ page, limit: size, tab: 'ALL' }, authContext);
    const rows = result.items || [];
    summary.total = result.total || summary.total;
    if (!rows.length) break;

    if (apply) {
      const orderIds = [];
      for (const row of rows) {
        const orderId = row.order?._id || row.order?.id;
        try {
          await projectionService.upsertOrderWorkbenchRow(row, { source: 'ORDER_WORKBENCH_BACKFILL' });
          summary.processed += 1;
          orderIds.push(orderId);
        } catch (error) {
          summary.failures.push({ orderId: String(orderId || ''), error: error.message });
        }
      }
      const persisted = await OrderWorkbenchProjection.countDocuments({ orderId: { $in: orderIds } });
      summary.verified += persisted;
      if (persisted !== orderIds.length) throw new Error(`Projection read-back failed for page ${page}`);
    }

    if (rows.length < size || summary.processed + summary.failures.length >= summary.total) break;
  }
  return summary;
}

async function main() {
  const args = parseArgs();
  await connectDatabase();
  try {
    await OrderWorkbenchProjection.createIndexes();
    const result = await backfillOrderWorkbenchProjections({
      apply: String(args.apply || 'false').toLowerCase() === 'true',
      batchSize: args['batch-size'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { backfillOrderWorkbenchProjections, parseArgs };
