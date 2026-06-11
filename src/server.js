const createApp = require('./app');
const config = require('./config');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');

async function bootstrap() {
  await connectDatabase();

  if (config.redis.enabled) {
    await connectRedis();
  } else {
    console.warn('Redis connection disabled by REDIS_ENABLED=false');
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received. Shutting down.`);
    server.close(async () => {
      const shutdownTasks = [disconnectDatabase()];

      if (config.redis.enabled) {
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
  console.error('Failed to start server', error);
  process.exit(1);
});
