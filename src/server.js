const createApp = require('./app');
const config = require('./config');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');
const {
  startExternalOrderImportWorkers,
  stopExternalOrderImportWorkers,
} = require('./modules/integration/externalOrderImport/workers');
const logger = require('./shared/utils/logger');

async function bootstrap() {
  await connectDatabase();
  let importWorkers = [];

  if (config.redis.enabled) {
    await connectRedis();
    importWorkers = startExternalOrderImportWorkers();
  } else {
    logger.warn('redis_connection_disabled');
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info('server_started', { port: config.port });
  });

  async function shutdown(signal) {
    logger.info('server_shutdown_started', { signal });
    server.close(async () => {
      const shutdownTasks = [disconnectDatabase()];

      if (config.redis.enabled) {
        shutdownTasks.push(stopExternalOrderImportWorkers(importWorkers));
        shutdownTasks.push(disconnectRedis());
      }

      await Promise.allSettled(shutdownTasks);
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error('server_start_failed', { error });
  process.exit(1);
});
