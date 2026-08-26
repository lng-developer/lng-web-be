const mongoose = require('mongoose');
const config = require('./index');

async function connectDatabase() {
  mongoose.set('strictQuery', true);

  await mongoose.connect(config.database.uri, {
    autoIndex: config.env !== 'production',
    serverSelectionTimeoutMS: 10000,
  });

  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

async function initializeModels() {
  const models = mongoose.modelNames().map((name) => mongoose.model(name));
  await Promise.all(models.map((model) => model.init()));
  return models.length;
}

async function getMongoConnectionTelemetry() {
  const client = mongoose.connection.getClient?.();
  const servers = [...(client?.topology?.description?.servers || new Map()).values()];
  const selectedServer = servers.find((server) => server.type === 'RSPrimary') || servers[0];
  const driverRoundTripMs = selectedServer?.roundTripTime ?? null;

  if (!mongoose.connection.db) {
    return { pingMs: null, driverRoundTripMs, errorCode: 'MONGO_NOT_CONNECTED' };
  }

  try {
    const startedAt = Date.now();
    await mongoose.connection.db.admin().command({ ping: 1 });
    return { pingMs: Date.now() - startedAt, driverRoundTripMs, errorCode: null };
  } catch (error) {
    return {
      pingMs: null,
      driverRoundTripMs,
      errorCode: String(error?.code || 'MONGO_PING_FAILED').slice(0, 64),
    };
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getMongoConnectionTelemetry,
  initializeModels,
};
