const { createQueue, createWorker } = require('../../../config/queue');
const logger = require('../../../shared/utils/logger');
const { processDueAnnouncements } = require('../services/announcement.service');

const QUEUE_NAME = 'hr-announcements';

async function processAnnouncementJob() {
  return processDueAnnouncements(new Date());
}

async function start() {
  require('dotenv').config();
  const { connectDatabase, disconnectDatabase } = require('../../../config/database');
  await connectDatabase();
  const queue = createQueue(QUEUE_NAME);
  await queue.upsertJobScheduler(
    'announcement-publish-reminder',
    { every: 60_000 },
    { name: 'process-due-announcements', data: {} },
  );
  const worker = createWorker(QUEUE_NAME, processAnnouncementJob, { concurrency: 1 });
  worker.on('failed', (job, error) => logger.error('announcement_job_failed', { jobId: job?.id, error }));
  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await disconnectDatabase();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { queue, worker };
}

if (require.main === module) {
  start().catch((error) => {
    logger.error('announcement_worker_start_failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { processAnnouncementJob, start };
