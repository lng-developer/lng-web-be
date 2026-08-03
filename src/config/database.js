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

module.exports = {
  connectDatabase,
  disconnectDatabase,
  initializeModels,
};
