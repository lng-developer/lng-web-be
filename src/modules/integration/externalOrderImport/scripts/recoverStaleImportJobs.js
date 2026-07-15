const { connectDatabase, disconnectDatabase } = require('../../../../config/database');
const { connectRedis, disconnectRedis } = require('../../../../config/redis');
const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');
const service = require('../services/externalOrderImport.service');

async function main() {
  await connectDatabase();
  if (config.redis.enabled) await connectRedis();

  const result = await service.recoverStaleImportJobs({
    staleMinutes: Number(process.env.STALE_IMPORT_MINUTES || 30),
    limit: Number(process.env.STALE_IMPORT_LIMIT || 50),
  });

  logger.info('stale_import_jobs_recovered', result);
  if (config.redis.enabled) await disconnectRedis();
  await disconnectDatabase();
}

if (require.main === module) {
  main().catch(async (error) => {
    logger.error('stale_import_jobs_recovery_failed', { error });
    if (config.redis.enabled) await disconnectRedis().catch(() => {});
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
}

module.exports = { main };
