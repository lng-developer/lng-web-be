require('dotenv').config();

const { connectDatabase, disconnectDatabase } = require('../../../../config/database');
const logger = require('../../../../shared/utils/logger');
const { startExternalOrderImportWorkers, stopExternalOrderImportWorkers } = require('./index');

let workers = [];

async function shutdown() {
  await stopExternalOrderImportWorkers(workers);
  await disconnectDatabase();
  process.exit(0);
}

async function start() {
  await connectDatabase();
  workers = startExternalOrderImportWorkers();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

start().catch((error) => {
  logger.error('external_order_import_workers_start_failed', { error });
  process.exitCode = 1;
});
