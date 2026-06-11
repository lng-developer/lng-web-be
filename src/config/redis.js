const Redis = require('ioredis');
const config = require('./index');

let client;

function getRedisClient() {
  if (!client) {
    client = new Redis({
      ...config.redis,
      lazyConnect: true,
    });
  }

  return client;
}

async function connectRedis() {
  const redis = getRedisClient();

  if (redis.status === 'ready') {
    return redis;
  }

  await redis.connect();
  return redis;
}

async function disconnectRedis() {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

module.exports = {
  getRedisClient,
  connectRedis,
  disconnectRedis,
};
