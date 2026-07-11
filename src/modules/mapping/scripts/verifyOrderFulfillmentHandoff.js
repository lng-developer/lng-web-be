const fs = require('fs');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const mappingPublic = require('../public');
const orderPublic = require('../../order/public');
const productionPublic = require('../../production/public');

const AMAZON_ORDER_ID_PATTERN = /\b\d{3}-\d{7}-\d{7}\b/g;

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const raw = argv.reduce((args, arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    if (!key) return args;
    return { ...args, [key]: value.length ? value.join('=') : true };
  }, {});
  const write = parseBoolean(raw.write, false);
  return {
    ...raw,
    write,
    dryRun: !write,
    limit: Number.parseInt(raw.limit || '20', 10),
    salesChannelCode: raw.salesChannelCode || 'AMAZON',
    marketplaceCode: raw.marketplaceCode || 'AMAZON_US',
  };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function extractAmazonOrderIds(text = '') {
  return unique(String(text).match(AMAZON_ORDER_ID_PATTERN) || []);
}

function reportAuth(write = false) {
  return {
    system: true,
    source: 'FULFILLMENT_HANDOFF_LIVE_CHECK',
    permissions: [
      write ? 'MAPPING:WRITE' : 'MAPPING:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
    ],
  };
}

function summarizeItemResult({
  item,
  preview,
  plan,
  task,
  write,
}) {
  const selected = plan || (preview && preview.autoMatch ? {
    vendorProductId: preview.autoMatch.vendorProductId,
    vendorCostCenterId: preview.autoMatch.vendorCostCenterId,
  } : null);
  const blockingReasons = preview?.blockingReasons || [];
  const unmatchedReason = selected
    ? null
    : (blockingReasons[0] || (preview?.ready ? 'NO_AUTOMATCH' : 'PREVIEW_NOT_READY'));

  return {
    orderId: toId(item.orderId),
    orderItemId: toId(item),
    externalOrderId: item.externalOrderId || null,
    externalItemId: item.externalItemId || null,
    sku: item.sku || null,
    itemStatus: item.status || null,
    matched: Boolean(selected),
    wouldResolve: !write && Boolean(preview?.ready && preview?.autoMatch),
    blockingReasons,
    unmatchedReason,
    vendorProductId: toId(selected?.vendorProductId || selected?.vendorProduct),
    vendorCostCenterId: toId(selected?.vendorCostCenterId || selected?.vendorCostCenter),
    fulfillmentPlanStatus: plan?.status || null,
    selectionMode: plan?.selectionMode || null,
    productionTaskCreated: Boolean(task),
    productionTaskId: toId(task),
    productionStatus: task?.status || null,
    productionBlockers: task?.blockers || [],
  };
}

async function loadOrderItemsFromArgs(args = {}) {
  const items = [];

  for (const orderItemId of parseList(args.orderItemIds)) {
    const item = await orderPublic.findItemById(orderItemId);
    if (item) items.push(item);
  }

  for (const orderId of parseList(args.orderIds)) {
    const orderItems = await orderPublic.listItemsByOrder(orderId);
    items.push(...(orderItems || []));
  }

  const externalOrderIds = [
    ...parseList(args.externalOrderIds),
    ...(args.file ? extractAmazonOrderIds(fs.readFileSync(args.file, 'utf8')) : []),
  ];

  for (const externalOrderId of unique(externalOrderIds)) {
    const order = typeof orderPublic.findByExternalIdentity === 'function'
      ? await orderPublic.findByExternalIdentity({
        salesChannelCode: args.salesChannelCode,
        marketplaceCode: args.marketplaceCode,
        externalOrderId,
      })
      : null;
    if (!order) continue;
    const orderItems = await orderPublic.listItemsByOrder(toId(order));
    items.push(...(orderItems || []));
  }

  return unique(items.map(toId))
    .slice(0, Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 20);
}

async function getProductionTask(orderItemId, authContext) {
  try {
    return await productionPublic.getTaskByOrderItem(orderItemId, authContext);
  } catch (_error) {
    return null;
  }
}

async function ensureProductionTaskForReadyPlan(orderItemId, plan, authContext) {
  if (!plan || plan.status !== 'READY') return null;
  if (typeof productionPublic.createOrRecheckTaskForOrderItem !== 'function') return null;
  try {
    return await productionPublic.createOrRecheckTaskForOrderItem(orderItemId, {
      ...authContext,
      system: true,
      source: 'FULFILLMENT_HANDOFF_LIVE_CHECK',
    });
  } catch (_error) {
    return null;
  }
}

async function verifyOrderFulfillmentHandoff(args = {}) {
  if (parseBoolean(args.resetOrders, false) || parseBoolean(args.importFile, false)) {
    throw new Error('resetOrders/importFile are intentionally not supported by this live-check script; import/reset explicitly through the import API first.');
  }

  const itemIds = await loadOrderItemsFromArgs(args);
  const authContext = reportAuth(Boolean(args.write));
  const items = [];

  for (const orderItemId of itemIds) {
    const item = await orderPublic.findItemById(orderItemId);
    const preview = await mappingPublic.previewFulfillmentPlan(orderItemId, {}, authContext);

    if (args.write && preview.ready && preview.autoMatch) {
      await mappingPublic.resolveFulfillmentPlan(orderItemId, {}, authContext);
    }

    const plan = await mappingPublic.getFulfillmentPlanForOrderItem(orderItemId, authContext);
    const task = (args.write && plan?.status === 'READY')
      ? await ensureProductionTaskForReadyPlan(orderItemId, plan, authContext)
      : await getProductionTask(orderItemId, authContext);
    items.push(summarizeItemResult({
      item,
      preview,
      plan,
      task,
      write: Boolean(args.write),
    }));
  }

  return {
    dryRun: !args.write,
    write: Boolean(args.write),
    checkedCount: items.length,
    matchedCount: items.filter((item) => item.matched).length,
    productionTaskCount: items.filter((item) => item.productionTaskCreated).length,
    items,
  };
}

async function main() {
  const args = parseArgs();
  await connectDatabase();
  try {
    const report = await verifyOrderFulfillmentHandoff(args);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
  extractAmazonOrderIds,
  parseArgs,
  summarizeItemResult,
  verifyOrderFulfillmentHandoff,
};
