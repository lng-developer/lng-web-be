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

function normalizeMigrationState(state = {}) {
  const normalizeDate = (value) => value ? new Date(value).toISOString() : null;
  return {
    key: state.key,
    status: state.status,
    lastSourceTimestamp: normalizeDate(state.lastSourceTimestamp),
    lastSourceEventId: state.lastSourceEventId || null,
    lastSourceBatchId: state.lastSourceBatchId || null,
    lastResult: {
      fetched: Number(state.lastResult?.fetched || 0),
      inserted: Number(state.lastResult?.inserted || 0),
      updated: Number(state.lastResult?.updated || 0),
      unchanged: Number(state.lastResult?.unchanged || 0),
      failed: Number(state.lastResult?.failed || 0),
    },
    errorMessage: state.errorMessage || null,
    lastStartedAt: normalizeDate(state.lastStartedAt),
    lastFinishedAt: normalizeDate(state.lastFinishedAt),
  };
}

function toPersistenceState(normalized) {
  return Object.fromEntries(Object.entries(normalized).map(([key, value]) => [
    key,
    key.endsWith('At') && value ? new Date(value) : value,
  ]));
}

async function migrateLegacyState(state, { apply = false, model = SyncState } = {}) {
  if (!apply || !state) return { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  const normalized = normalizeMigrationState(state);
  const existing = await model.findOne({ key: normalized.key }).lean();
  if (existing && JSON.stringify(normalizeMigrationState(existing)) === JSON.stringify(normalized)) {
    return { inserted: 0, updated: 0, unchanged: 1, failed: 0 };
  }
  await model.findOneAndUpdate(
    { key: normalized.key }, { $set: toPersistenceState(normalized) }, { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  return existing ? { inserted: 0, updated: 1, unchanged: 0, failed: 0 } : { inserted: 1, updated: 0, unchanged: 0, failed: 0 };
}

module.exports = { advance, findExistingState, getState, markFailed, markRunning, migrateLegacyState, normalizeMigrationState };
