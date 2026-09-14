const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const MarketplaceFeeLine = require('../models/marketplaceFeeLine.model');
const MarketplaceSettlementLedgerLine = require('../models/marketplaceSettlementLedgerLine.model');

async function ensureFinanceImportIndexes({ manageConnection = true } = {}) {
  if (manageConnection) await connectDatabase();
  try {
    return await Promise.all([
      MarketplaceFeeLine.createIndexes(),
      MarketplaceSettlementLedgerLine.createIndexes(),
    ]);
  } finally {
    if (manageConnection) await disconnectDatabase();
  }
}

if (require.main === module) {
  ensureFinanceImportIndexes().catch((error) => {
    logger.error('finance_import_indexes_create_failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { ensureFinanceImportIndexes };
