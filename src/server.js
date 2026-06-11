const createApp = require('./app');
const config = require('./config');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');

async function bootstrap() {
  await connectDatabase();
  await connectRedis();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received. Shutting down.`);
    server.close(async () => {
      await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
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
