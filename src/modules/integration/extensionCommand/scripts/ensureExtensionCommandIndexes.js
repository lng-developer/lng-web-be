const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const ExtensionCommand = require('../models/extensionCommand.model');

async function ensureExtensionCommandIndexes({ manageConnection = true } = {}) {
  if (manageConnection) await connectDatabase();
  try {
    const indexes = await ExtensionCommand.createIndexes();
    logger.info('extension_command_indexes_created', { indexes });
    return indexes;
  } finally {
    if (manageConnection) await disconnectDatabase();
  }
}

if (require.main === module) {
  ensureExtensionCommandIndexes().catch((error) => {
    logger.error('extension_command_indexes_create_failed', { error });
    process.exit(1);
  });
}

module.exports = { ensureExtensionCommandIndexes };
