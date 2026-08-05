const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const orderPublic = require('../../order/public');
const mappingService = require('../services/fulfillmentPlan.service');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((result, arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return { ...result, [key]: value };
  }, {});
}

async function backfillFulfillmentPlans({ dryRun = true, batchSize = 50, limit = null } = {}) {
  const size = Math.min(Math.max(Number(batchSize) || 50, 1), 100);
  const cap = Number(limit) > 0 ? Number(limit) : Infinity;
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    dryRun,
    totalOrderItems: 0,
    existingPlans: 0,
    missingPlans: 0,
    processed: 0,
    createdOrUpdated: 0,
    failures: [],
  };

  for (let page = 1; summary.totalOrderItems < cap; page += 1) {
    const pageLimit = Math.min(size, cap - summary.totalOrderItems);
    const result = await orderPublic.listItems({ page, limit: pageLimit });
    const items = result.items || [];
    if (!items.length) break;
    const ids = items.map((item) => String(item._id || item.id));
    const plans = await mappingService.listFulfillmentPlansByOrderItemIds(ids, { system: true });
    const existingIds = new Set(plans.map((plan) => String(plan.orderItemId)));
    const missingIds = ids.filter((id) => !existingIds.has(id));
    summary.totalOrderItems += items.length;
    summary.existingPlans += existingIds.size;
    summary.missingPlans += missingIds.length;

    if (!dryRun) {
      for (const orderItemId of missingIds) {
        summary.processed += 1;
        try {
          await mappingService.recheckFulfillmentPlan(orderItemId, {}, { system: true, source: 'MAPPING_BACKFILL' });
          summary.createdOrUpdated += 1;
        } catch (error) {
          summary.failures.push({ orderItemId, error: error.message });
        }
      }
    }

    const total = result.total || result.pagination?.total || 0;
    if (items.length < pageLimit || summary.totalOrderItems >= total) break;
  }
  return summary;
}

async function main() {
  const args = parseArgs();
  await connectDatabase();
  try {
    const result = await backfillFulfillmentPlans({
      dryRun: String(args['dry-run'] || 'true').toLowerCase() !== 'false',
      batchSize: args['batch-size'],
      limit: args.limit,
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

module.exports = { backfillFulfillmentPlans, parseArgs };
