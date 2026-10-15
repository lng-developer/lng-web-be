const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Message = require('../models/message.model');

async function ensureChatIndexes({ manageConnection = true } = {}) {
  if (manageConnection) await connectDatabase();
  try {
    const result = await Message.createIndexes();
    logger.info('chat_indexes_created', { result });
    return result;
  } finally {
    if (manageConnection) await disconnectDatabase();
  }
}

if (require.main === module) {
  ensureChatIndexes().catch((error) => {
    logger.error('chat_indexes_create_failed', { error });
    process.exit(1);
  });
}

module.exports = { ensureChatIndexes };
