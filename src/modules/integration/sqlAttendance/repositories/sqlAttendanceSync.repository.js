const SyncState = require('../models/sqlAttendanceSync.model');

async function getState(key = 'default') {
  return SyncState.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, status: 'IDLE' } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

async function findExistingState(key = 'default') {
  return SyncState.findOne({ key }).lean();
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
  key = 'default', lastSourceTimestamp, lastSourceEventId, sourceBatchId, result,
}) {
  return SyncState.findOneAndUpdate(
    { key },
    { $set: {
      status: 'SUCCESS',
      lastSourceTimestamp,
      lastSourceEventId,
      lastSourceBatchId: sourceBatchId || null,
      lastResult: result,
      errorMessage: null,
      lastFinishedAt: new Date(),
    } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

async function migrateLegacyState(state, { apply = false } = {}) {
  if (!apply || !state) return { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  const existing = await SyncState.findOne({ key: state.key }).lean();
  await SyncState.findOneAndUpdate(
    { key: state.key }, { $set: state }, { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  return existing ? { inserted: 0, updated: 1, unchanged: 0, failed: 0 } : { inserted: 1, updated: 0, unchanged: 0, failed: 0 };
}

module.exports = { advance, findExistingState, getState, markFailed, markRunning, migrateLegacyState };
