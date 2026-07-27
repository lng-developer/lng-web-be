const repository = require('./repositories/sqlAttendanceSync.repository');
const { syncPage } = require('./services/sqlAttendanceImport.service');
const { QUEUE_NAME } = require('./workers/sqlAttendance.worker');

let queue;

function getQueue() {
  if (!queue) queue = require('../../../config/queue').createQueue(QUEUE_NAME);
  return queue;
}

async function enqueueSync({ limit } = {}) {
  const job = await getQueue().add('sync-page', { limit }, {
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  return { jobId: String(job.id), status: 'QUEUED' };
}

async function getStatus() {
  const state = await repository.getState();
  return {
    status: state.status,
    lastSourceTimestamp: state.lastSourceTimestamp || null,
    lastSourceId: state.lastSourceId || null,
    lastSourceBatchId: state.lastSourceBatchId || null,
    lastResult: state.lastResult || null,
    errorMessage: state.errorMessage || null,
    lastStartedAt: state.lastStartedAt || null,
    lastFinishedAt: state.lastFinishedAt || null,
  };
}

module.exports = { enqueueSync, getStatus, syncPage };
