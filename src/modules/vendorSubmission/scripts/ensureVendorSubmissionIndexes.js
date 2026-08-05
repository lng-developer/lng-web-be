const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const VendorSubmission = require('../models/vendorSubmission.model');

async function ensureVendorSubmissionIndexes({ manageConnection = true } = {}) {
  if (manageConnection) await connectDatabase();
  try {
    const result = await VendorSubmission.syncIndexes();
    logger.info('vendor_submission_indexes_synced', { droppedIndexes: result });
    return result;
  } finally {
    if (manageConnection) await disconnectDatabase();
  }
}

if (require.main === module) {
  ensureVendorSubmissionIndexes().catch((error) => {
    logger.error('vendor_submission_indexes_sync_failed', { error });
    process.exit(1);
  });
}

module.exports = { ensureVendorSubmissionIndexes };
