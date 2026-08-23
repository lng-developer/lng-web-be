const createApp = require('./app');
const config = require('./config');
const { connectDatabase, disconnectDatabase, initializeModels } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');
const {
  startExternalOrderImportWorkers,
  stopExternalOrderImportWorkers,
} = require('./modules/integration/externalOrderImport/workers');
const {
  startPostImportMappingRecoveryScheduler,
  stopPostImportMappingRecoveryScheduler,
} = require('./modules/integration/externalOrderImport/services/postImportMappingRecoveryScheduler.service');
const {
  startVendorTrackingRecheckScheduler,
  stopVendorTrackingRecheckScheduler,
} = require('./modules/shipment/services/vendorTrackingRecheckScheduler.service');
const {
  startVendorSubmissionRecoveryScheduler,
  stopVendorSubmissionRecoveryScheduler,
} = require('./modules/vendorSubmission/services/vendorSubmissionRecoveryScheduler.service');
const {
  startExtensionOrderScheduleScheduler,
  stopExtensionOrderScheduleScheduler,
} = require('./modules/integration/extensionCommand/services/extensionOrderScheduleScheduler.service');
const logger = require('./shared/utils/logger');
const { attachChatSocket } = require('./realtime/chatSocket');

async function bootstrap() {
  await connectDatabase();
  if (config.env === 'production') await initializeModels();
  let importWorkers = [];

  if (config.redis.enabled) {
    await connectRedis();
    importWorkers = startExternalOrderImportWorkers();
    startPostImportMappingRecoveryScheduler();
  } else {
    logger.warn('redis_connection_disabled');
  }

  const app = createApp();
  startVendorTrackingRecheckScheduler();
  startVendorSubmissionRecoveryScheduler();
  startExtensionOrderScheduleScheduler();
  const server = app.listen(config.port, () => {
    logger.info('server_started', { port: config.port });
  });
  const chatSocket = attachChatSocket(server);

  async function shutdown(signal) {
    logger.info('server_shutdown_started', { signal });
    chatSocket.close();
    server.close(async () => {
      const shutdownTasks = [disconnectDatabase()];
      stopVendorTrackingRecheckScheduler();
      stopVendorSubmissionRecoveryScheduler();
      stopExtensionOrderScheduleScheduler();

      if (config.redis.enabled) {
        shutdownTasks.push(stopExternalOrderImportWorkers(importWorkers));
        stopPostImportMappingRecoveryScheduler();
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
