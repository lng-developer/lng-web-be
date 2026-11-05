const logger = require('../../../../shared/utils/logger');
const { syncPage } = require('./sqlAttendanceImport.service');

function createSqlAttendanceScheduler(dependencies = {}) {
  const syncFn = dependencies.syncPage || syncPage;
  const schedule = dependencies.setInterval || setInterval;
  const cancel = dependencies.clearInterval || clearInterval;
  const log = dependencies.logger || logger;
  let timer = null;
  let running = false;

  async function run() {
    if (running) return null;
    running = true;
    try {
      return await syncFn();
    } catch (error) {
      log.warn('sql_attendance_scheduler_sync_failed', { message: error.message });
      return null;
    } finally {
      running = false;
    }
  }

  function start() {
    const isConfigured = Boolean(
      process.env.DB_SERVER && (
        process.env.DB_ATTENDANCE_EVENT_ID_COLUMN ||
        String(process.env.DB_ATTENDANCE_USE_COMPOSITE_ID || '').trim().toLowerCase() === 'true'
      ),
    );
    const isEnabled = String(process.env.SQL_ATTENDANCE_ENABLED || (isConfigured ? 'true' : 'false')).trim().toLowerCase() === 'true';
    if (!isEnabled || !isConfigured || timer) return null;

    const pollIntervalMs = Math.max(
      Number.parseInt(process.env.SQL_ATTENDANCE_POLL_INTERVAL_MS || '300000', 10) || 300000,
      30000,
    );
    timer = schedule(run, pollIntervalMs);
    timer.unref?.();
    log.info('sql_attendance_scheduler_started', { intervalMs: pollIntervalMs });
    return timer;
  }

  function stop() {
    if (!timer) return;
    cancel(timer);
    timer = null;
  }

  return { run, start, stop };
}

const scheduler = createSqlAttendanceScheduler();

module.exports = {
  createSqlAttendanceScheduler,
  runSqlAttendanceOnce: scheduler.run,
  startSqlAttendanceScheduler: scheduler.start,
  stopSqlAttendanceScheduler: scheduler.stop,
};
