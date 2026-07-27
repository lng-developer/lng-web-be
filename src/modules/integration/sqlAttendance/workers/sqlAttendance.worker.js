const { syncPage } = require('../services/sqlAttendanceImport.service');

const QUEUE_NAME = 'sql-attendance';

async function processSqlAttendanceJob(job, dependencies = {}) {
  const run = dependencies.syncPage || syncPage;
  return run({ limit: job.data?.limit });
}

async function start() {
  require('dotenv').config();
  const { connectDatabase, disconnectDatabase } = require('../../../../config/database');
  const { createWorker } = require('../../../../config/queue');
  const logger = require('../../../../shared/utils/logger');
  await connectDatabase();
  const worker = createWorker(QUEUE_NAME, processSqlAttendanceJob, { concurrency: 1 });
  worker.on('failed', (job, error) => logger.error('SQL attendance sync failed', { jobId: job?.id, error: error.message }));
  const shutdown = async () => {
    await worker.close();
    await disconnectDatabase();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return worker;
}

if (require.main === module) {
  const logger = require('../../../../shared/utils/logger');
  start().catch((error) => {
    logger.error('SQL attendance worker failed to start', { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = { QUEUE_NAME, processSqlAttendanceJob, start };
