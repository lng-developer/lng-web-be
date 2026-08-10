const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const orderPublic = require('../../../src/modules/order/public');
const mappingPublic = require('../../../src/modules/mapping/public');

const SYSTEM_CONTEXT = { system: true, source: 'EXTERNAL_ORDER_IMPORT_RECOVERY' };

function isReadyPlan(plan) {
  return ['READY', 'CONFIRMED'].includes(plan?.status);
}

async function recoverPostImportMappings({ limit = 100 } = {}) {
  let page = 1;
  const result = { checked: 0, resolved: 0, blocked: 0, resetToMappingPending: 0 };
  const orderIds = new Set();

  do {
    const batch = await orderPublic.listItems({ page, limit });
    for (const item of batch.items || []) {
      result.checked += 1;
      orderIds.add(String(item.orderId));
      const orderItemId = String(item._id || item.id);
      const existingPlan = await mappingPublic.getFulfillmentPlanForOrderItem(orderItemId, SYSTEM_CONTEXT);
      if (isReadyPlan(existingPlan)) continue;

      const resolved = await mappingPublic.recheckFulfillmentPlan(orderItemId, {}, SYSTEM_CONTEXT);
      if (isReadyPlan(resolved)) {
        result.resolved += 1;
        continue;
      }

      result.blocked += 1;
      if (item.status === 'FULFILLMENT_READY') {
        await orderPublic.transitionItemStatus(orderItemId, 'MAPPING_PENDING', SYSTEM_CONTEXT);
        result.resetToMappingPending += 1;
      }
    }
    page += 1;
    if (page > (batch.totalPages || Math.ceil((batch.total || 0) / limit))) break;
  } while (true);

  await Promise.all([...orderIds].map((orderId) => Promise.all([
    orderPublic.updateCostCenterStatusForOrder(orderId),
    orderPublic.updatePsdStatusForOrder(orderId),
  ])));
  return result;
}

async function main() {
  await connectDatabase();
  try {
    const result = await recoverPostImportMappings();
    console.log(JSON.stringify(result));
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

module.exports = { recoverPostImportMappings };
