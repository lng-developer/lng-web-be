const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const RefundRecord = require('../../../src/modules/finance/models/refundRecord.model');
const FinanceRecalculationGuard = require('../../../src/modules/finance/models/financeRecalculationGuard.model');
const FinanceRecalculationRequest = require('../../../src/modules/finance/models/financeRecalculationRequest.model');
const FulfillmentSideEffectRequest = require('../../../src/modules/mapping/models/fulfillmentSideEffectRequest.model');
const VendorTrackingPoll = require('../../../src/modules/shipment/models/vendorTrackingPoll.model');
const logger = require('../../../src/shared/utils/logger');

async function main() {
  await connectDatabase();
  try {
    // MongoDB must create the guard collection before the first financial transaction.
    await FinanceRecalculationGuard.createCollection();
    await RefundRecord.collection.createIndex({ 'allocations.orderItemId': 1 }, { name: 'finance_refund_allocation_item_idx', sparse: true });
    for (const model of [FinanceRecalculationRequest, FulfillmentSideEffectRequest, VendorTrackingPoll]) {
      await model.createIndexes();
      logger.info('background_flow_indexes_ready', { collection: model.collection.name });
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  logger.error('background_flow_indexes_failed', { error });
  process.exitCode = 1;
});
