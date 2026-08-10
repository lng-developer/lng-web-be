const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

function assertTestDatabaseName(name) {
  if (!/(^|[_-])test([_-]|$)/i.test(String(name || ''))) {
    throw new Error(`Refusing non-test Mongo database: ${name || '(empty)'}`);
  }
}

async function startIsolatedMongo(name) {
  assertTestDatabaseName(name);
  const server = await MongoMemoryServer.create({ instance: { dbName: name } });
  await mongoose.connect(server.getUri(name));
  assertTestDatabaseName(mongoose.connection.name);
  return {
    stop: async () => {
      await mongoose.disconnect();
      await server.stop();
    },
  };
}

module.exports = { assertTestDatabaseName, startIsolatedMongo };
