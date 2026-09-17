const { connectDatabase, disconnectDatabase } = require('../../../../config/database');
const logger = require('../../../../shared/utils/logger');
const Job = require('../models/listingImageSyncJob.model');
const Schedule = require('../models/listingImageSyncSchedule.model');
const Command = require('../../extensionCommand/models/extensionCommand.model');

async function ensureIndexes() {
  const connection = await connectDatabase();
  try {
    logger.info('listing_image_sync_index_target', { database: connection.name });
    await Promise.all([Job.createIndexes(), Schedule.createIndexes(), Command.createIndexes()]);
    logger.info('listing_image_sync_indexes_created');
  } finally { await disconnectDatabase(); }
}
if (require.main === module) ensureIndexes().catch((error) => { logger.error('listing_image_sync_indexes_failed', { error }); process.exitCode = 1; });
module.exports = { ensureIndexes };
