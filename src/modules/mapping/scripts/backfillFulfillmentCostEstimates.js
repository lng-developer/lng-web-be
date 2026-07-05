const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const customizationPublic = require('../../customization/public');
const orderPublic = require('../../order/public');
const vendorPublic = require('../../vendor/public');
const { fulfillmentPlanStatuses } = require('../constants/fulfillmentPlan.constants');
const FulfillmentPlan = require('../models/fulfillmentPlan.model');
const {
  buildCostEstimate,
  parseInternalSku,
} = require('../services/fulfillmentPlan.service');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    if (!key) return args;
    return { ...args, [key]: value.length ? value.join('=') : true };
  }, { dryRun: 'true', limit: null });
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function missingCostEstimateFilter() {
  return {
    status: { $in: [fulfillmentPlanStatuses.READY, fulfillmentPlanStatuses.CONFIRMED] },
    vendorProductId: { $ne: null },
    vendorCostCenterId: { $ne: null },
    $or: [
      { 'snapshot.costEstimate': { $exists: false } },
      { 'snapshot.costEstimate': null },
    ],
  };
}

async function getCustomerInputs(orderItemId) {
  try {
    const view = await customizationPublic.getOrderItemCustomizationView(orderItemId);
    return view && view.customerInputs ? view.customerInputs : {};
  } catch (_error) {
    return {};
  }
}

async function getSelectedCostCenter(plan) {
  const costCenters = await vendorPublic.listActiveVendorCostCenters(plan.vendorProductId);
  return (costCenters || []).find((costCenter) => toId(costCenter) === toId(plan.vendorCostCenterId)) || null;
}

function skuForCostSignals(plan, item) {
  return (
    plan.snapshot?.listing?.sku
    || plan.snapshot?.orderItem?.sku
    || item.sku
  );
}

async function buildEstimateForPlan(plan) {
  const item = await orderPublic.findItemById(plan.orderItemId);
  if (!item) return { skipped: true, reason: 'ORDER_ITEM_NOT_FOUND' };

  const costCenter = await getSelectedCostCenter(plan);
  if (!costCenter) return { skipped: true, reason: 'VENDOR_COST_CENTER_NOT_FOUND' };

  const customerInputs = await getCustomerInputs(plan.orderItemId);
  return {
    skipped: false,
    costEstimate: buildCostEstimate({
      costCenter,
      item,
      skuMapping: parseInternalSku(skuForCostSignals(plan, item)),
      customerInputs,
      normalizedInputs: [],
    }),
  };
}

async function backfillFulfillmentCostEstimates({ dryRun = true, limit = null } = {}) {
  let query = FulfillmentPlan.find(missingCostEstimateFilter()).sort({ updatedAt: 1, _id: 1 }).lean();
  const numericLimit = Number(limit);
  if (Number.isInteger(numericLimit) && numericLimit > 0) query = query.limit(numericLimit);

  const plans = await query;
  const summary = {
    dryRun,
    database: mongoose.connection.db?.databaseName || null,
    matched: plans.length,
    wouldUpdate: 0,
    updated: 0,
    skipped: 0,
    failures: [],
  };

  for (const plan of plans) {
    const result = await buildEstimateForPlan(plan);
    if (result.skipped) {
      summary.skipped += 1;
      summary.failures.push({
        fulfillmentPlanId: toId(plan),
        orderItemId: toId(plan.orderItemId),
        reason: result.reason,
      });
      continue;
    }

    if (!dryRun) {
      const update = await FulfillmentPlan.updateOne(
        { _id: plan._id, ...missingCostEstimateFilter() },
        { $set: { 'snapshot.costEstimate': result.costEstimate } },
        { runValidators: true },
      );
      if (update.modifiedCount !== 1) {
        summary.skipped += 1;
        summary.failures.push({
          fulfillmentPlanId: toId(plan),
          orderItemId: toId(plan.orderItemId),
          reason: 'PLAN_CHANGED',
        });
        continue;
      }
    }

    if (dryRun) {
      summary.wouldUpdate += 1;
    } else {
      summary.updated += 1;
    }
  }

  return summary;
}

async function main() {
  const args = parseArgs();
  const dryRun = String(args.dryRun).toLowerCase() !== 'false';

  await connectDatabase();
  try {
    const summary = await backfillFulfillmentCostEstimates({
      dryRun,
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

module.exports = {
  backfillFulfillmentCostEstimates,
  buildEstimateForPlan,
  missingCostEstimateFilter,
  parseArgs,
};
