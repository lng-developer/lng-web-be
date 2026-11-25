const { createScheduledRunTracker } = require('../../../shared/utils/scheduledRunTracker');
const logger = require('../../../shared/utils/logger');
const snapshotService = require('./mongoIndexUsageSnapshot.service');
const { withDistributedLock } = require('../../../shared/utils/distributedLock');

let timer = null;
let running = false;
const runs = createScheduledRunTracker();

function isEnabled() {
  return String(process.env.MONGO_INDEX_USAGE_SNAPSHOT_ENABLED || 'true').toLowerCase() !== 'false';
}

function intervalMs() {
  return Math.max(Number(process.env.MONGO_INDEX_USAGE_SNAPSHOT_INTERVAL_MS) || 24 * 60 * 60 * 1000, 60 * 60 * 1000);
}

async function runOnce() {
  if (running) return null;
  return withDistributedLock('scheduler:mongo_index_usage_snapshot', 300000, async () => {
    if (running) return null;
    running = true;
    try {
      const result = await snapshotService.collectAndStore();
      logger.info('mongo_index_usage_snapshot_completed', result);
      return result;
    } catch (error) {
      logger.warn('mongo_index_usage_snapshot_failed', { error });
      return null;
    } finally {
      running = false;
    }
  });
}

function startMongoIndexUsageSnapshotScheduler() {
  if (!isEnabled() || timer) return null;
  runs.track(runOnce());
  timer = setInterval(() => runs.track(runOnce()), intervalMs());
  timer.unref?.();
  logger.info('mongo_index_usage_snapshot_scheduler_started', { intervalMs: intervalMs() });
  return timer;
}

function stopMongoIndexUsageSnapshotScheduler() {
  if (!timer) return runs.drain();
  clearInterval(timer);
  timer = null;
  return runs.drain();
}

module.exports = {
  runOnce,
  startMongoIndexUsageSnapshotScheduler,
  stopMongoIndexUsageSnapshotScheduler,
};
