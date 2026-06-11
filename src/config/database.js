const mongoose = require('mongoose');
const config = require('./index');

async function connectDatabase() {
  mongoose.set('strictQuery', true);

  await mongoose.connect(config.database.uri, {
    autoIndex: config.env !== 'production',
  });

  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
};
