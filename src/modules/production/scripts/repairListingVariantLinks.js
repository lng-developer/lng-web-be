const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const mappingPublic = require('../../mapping/public');
const ProductionTask = require('../models/productionTask.model');

const SYSTEM_CONTEXT = { system: true, source: 'PRODUCTION_VARIANT_REPAIR' };
const TERMINAL_STATUSES = ['SENT_TO_VENDOR', 'CANCELLED'];

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((result, arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return { ...result, [key]: value };
  }, {});
}

function addReason(summary, reason) {
  summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
}

function unresolvedReason(plan) {
  const reasons = plan?.blockingReasons || [];
  if (reasons.includes('LISTING_NOT_FOUND') || !plan?.listingId) return 'LISTING_NOT_FOUND';
  if (reasons.includes('LISTING_VARIANT_NOT_FOUND')) return 'LISTING_VARIANT_NOT_FOUND';
  return 'VARIANT_UNRESOLVED';
}

async function repairListingVariantLinks({ dryRun = true, limit = null } = {}) {
  let cursor = ProductionTask.collection.find(
    {
      status: { $nin: TERMINAL_STATUSES },
      blockers: 'TEMPLATE_NOT_FOUND',
      $or: [{ listingVariantId: null }, { listingVariantId: { $exists: false } }],
    },
    { projection: { _id: 1, orderItemId: 1 } },
  ).sort({ _id: 1 });
  if (Number(limit) > 0) cursor = cursor.limit(Number(limit));
  const tasks = await cursor.toArray();
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    dryRun,
    checked: tasks.length,
    eligible: 0,
    repaired: 0,
    skipped: 0,
    failed: 0,
    reasons: {},
    failures: [],
  };

  for (const task of tasks) {
    const orderItemId = String(task.orderItemId);
    try {
      const current = await mappingPublic.getFulfillmentPlanForOrderItem(orderItemId, SYSTEM_CONTEXT);
      if (current?.listingVariantId) {
        summary.skipped += 1;
        addReason(summary, 'ALREADY_LINKED');
        continue;
      }
      const confirmedUnresolved = (current?.blockingReasons || []).find((reason) => (
        reason === 'LISTING_NOT_FOUND' || reason === 'LISTING_VARIANT_NOT_FOUND'
      ));
      if (confirmedUnresolved) {
        summary.skipped += 1;
        addReason(summary, confirmedUnresolved);
        continue;
      }

      summary.eligible += 1;
      if (dryRun) {
        addReason(summary, 'NEEDS_RECHECK');
        continue;
      }

      const repaired = await mappingPublic.recheckFulfillmentPlan(orderItemId, {}, SYSTEM_CONTEXT);
      if (repaired?.listingVariantId) {
        summary.repaired += 1;
        addReason(summary, repaired.status === 'READY' ? 'READY' : 'LINKED_BLOCKED');
      } else {
        summary.skipped += 1;
        addReason(summary, unresolvedReason(repaired));
      }
    } catch (error) {
      summary.failed += 1;
      addReason(summary, 'ERROR');
      summary.failures.push({ orderItemId, error: error.message });
    }
  }

  return summary;
}

async function main() {
  const args = parseArgs();
  await connectDatabase();
  try {
    const summary = await repairListingVariantLinks({
      dryRun: !Object.prototype.hasOwnProperty.call(args, 'apply'),
      limit: args.limit,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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

module.exports = { parseArgs, repairListingVariantLinks };
