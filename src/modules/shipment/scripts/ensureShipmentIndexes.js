const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Shipment = require('../models/shipment.model');
const VendorWebhookLog = require('../models/vendorWebhookLog.model');

async function ensureShipmentIndexes({ manageConnection = true } = {}) {
  if (manageConnection) await connectDatabase();
  try {
    const [shipment, webhookLog] = await Promise.all([
      Shipment.syncIndexes(),
      VendorWebhookLog.syncIndexes(),
    ]);
    logger.info('shipment_indexes_synced', { shipment, webhookLog });
    return { shipment, webhookLog };
  } finally {
    if (manageConnection) await disconnectDatabase();
  }
}

if (require.main === module) {
  ensureShipmentIndexes().catch((error) => {
    logger.error('shipment_indexes_sync_failed', { error });
    process.exit(1);
  });
}

module.exports = { ensureShipmentIndexes };
