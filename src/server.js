const config = require('./config');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');
const logger = require('./shared/utils/logger');

async function bootstrap() {
  const role = config.runtime.role;
  const durableFeatures = [
    config.mapping.durableSideEffectsEnabled,
    config.finance.durableRecalculationEnabled,
    config.shipment.trackingQueueEnabled,
  ];
  if (role !== 'combined' && (!config.redis.enabled || !durableFeatures.every(Boolean))) {
    throw new Error('Split runtime requires Redis, durable mapping and finance, and the tracking queue');
  }
  if (!config.redis.enabled && durableFeatures.some(Boolean)) {
    throw new Error('Durable background queues require Redis');
  }

  const stopIntake = [];
  const closeConnections = [];
  let closing;

  async function settle(operations) {
    const results = await Promise.allSettled(operations.map(async (operation) => operation()));
    for (const { status, reason } of results) {
      if (status === 'rejected') logger.error('runtime_shutdown_failed', { role, error: reason });
    }
  }

  function shutdown(signal) {
    if (!closing) {
      logger.info('server_shutdown_started', { role, signal });
      closing = settle(stopIntake).then(() => settle(closeConnections));
    }
    return closing;
  }

  try {
    closeConnections.push(disconnectDatabase);
    await connectDatabase();
    if (config.redis.enabled) {
      closeConnections.push(disconnectRedis);
      const redis = await connectRedis();
      redis?.on('error', (error) => logger.warn('runtime_redis_error', { role, errorCode: error.code }));
      if (durableFeatures.some(Boolean)) {
        const { connectQueueProducers } = require('./config/queue');
        closeConnections.push(await connectQueueProducers(redis));
      }
      if (role !== 'combined') {
        const { connectNotificationRelay } = require('./runtime/notificationRelay');
        closeConnections.push(await connectNotificationRelay({ role, redis, db: config.redis.db }));
      }
    } else {
      logger.warn('redis_connection_disabled');
    }

    if (config.redis.enabled && (role === 'combined' || role === 'worker')) {
      const { startWorkers } = require('./runtime/workers');
      const workers = startWorkers((worker) => {
        stopIntake.push(() => worker.close());
        worker.on('error', (error) => {
          logger.warn('runtime_worker_error', { queue: worker.name, errorCode: error.code });
        });
      });
      await Promise.all(workers.map((worker) => worker.waitUntilReady()));
    }

    if (role === 'combined' || role === 'scheduler') {
      const { startSchedulers } = require('./runtime/schedulers');
      await startSchedulers((stop) => stopIntake.push(stop));
    }

    if (role === 'combined' || role === 'api') {
      const createApp = require('./app');
      const { attachChatSocket } = require('./realtime/chatSocket');
      const { teamsChat } = require('./modules/integration/public');
      const server = createApp().listen(config.port, config.host);
      let chatSocket;
      stopIntake.push(() => chatSocket
        ? chatSocket.close()
        : new Promise((resolve) => server.close(resolve)));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('listening', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      chatSocket = attachChatSocket(server);
      stopIntake.push(teamsChat.detachTeamsOutboundListener);
      teamsChat.attachTeamsOutboundListener();
      logger.info('server_started', { host: config.host, port: config.port });
    }

    return { role, shutdown };
  } catch (error) {
    await shutdown('startup_failed');
    throw error;
  }
}

function run() {
  const started = bootstrap();
  let stopping = false;

  function onSignal(signal) {
    if (stopping) return;
    stopping = true;
    started.then(({ shutdown }) => shutdown(signal)).then(() => process.exit(0), () => {});
  }

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  started.then(({ role }) => {
    if (stopping) return;
    logger.info('runtime_ready', { role });
    process.send?.('ready');
  }).catch((error) => {
    logger.error('server_start_failed', { role: config.runtime.role, error });
    process.exit(1);
  });
}

if (require.main === module) run();
module.exports = { bootstrap, run };
