const SyncState = require('../models/sqlAttendanceSync.model');

async function getState(key = 'default') {
  return SyncState.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, status: 'IDLE' } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

async function markRunning(key = 'default') {
  return SyncState.findOneAndUpdate(
    { key },
    { $set: { status: 'RUNNING', errorMessage: null, lastStartedAt: new Date() } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

async function markFailed({ key = 'default', errorMessage }) {
  return SyncState.findOneAndUpdate(
    { key },
    { $set: { status: 'FAILED', errorMessage, lastFinishedAt: new Date() } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

async function advance({
  key = 'default', lastSourceTimestamp, lastSourceId, sourceBatchId, result,
}) {
  return SyncState.findOneAndUpdate(
    { key },
    { $set: {
      status: 'SUCCESS',
      lastSourceTimestamp,
      lastSourceId,
      lastSourceBatchId: sourceBatchId || null,
      lastResult: result,
      errorMessage: null,
      lastFinishedAt: new Date(),
    } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { advance, getState, markFailed, markRunning };
