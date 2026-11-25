const { createScheduledRunTracker } = require('../../../shared/utils/scheduledRunTracker');
const logger = require('../../../shared/utils/logger');
const { withDistributedLock } = require('../../../shared/utils/distributedLock');
const leaveService = require('./leave.service');

let timer = null;
let startupTimer;
let running = false;
const runs = createScheduledRunTracker();

// Check once an hour
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function getCurrentVietnamMonthYear() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
  };
}

/**
 * Accrues 1 day (2 units) of annual leave for all active (official) employees for the current month.
 * Idempotent: leave.repository ensures each month is only accrued once per employee via lastAccruedMonth.
 */
async function runOnce(options = {}, authContext = { system: true, source: 'MONTHLY_LEAVE_ACCRUAL_SCHEDULER' }) {
  if (running) return null;
  return withDistributedLock('scheduler:monthly_leave_accrual', 120000, async () => {
    if (running) return null;
    running = true;
    try {
      const { year: currentYear, month: currentMonth } = getCurrentVietnamMonthYear();
      const year = options.year || currentYear;
      const month = options.month || currentMonth;

      const result = await leaveService.accrueBalances({
        year,
        month,
        units: 2, // 1 day of leave = 2 units (0.5 day = 1 unit)
        reason: options.reason || `Tự động cộng 1 ngày phép định kỳ tháng ${month}/${year} cho nhân sự chính thức`,
      }, {
        ...authContext,
        system: true,
        source: authContext.source || 'MONTHLY_LEAVE_ACCRUAL_SCHEDULER',
      });

      if (result.changed > 0) {
        logger.info('monthly_leave_accrual_completed', {
          year,
          month,
          processed: result.processed,
          changed: result.changed,
        });
      }
      return result;
    } catch (error) {
      logger.warn('monthly_leave_accrual_failed', { error: error.message || error });
      return null;
    } finally {
      running = false;
    }
  });
}

function startMonthlyLeaveAccrualScheduler() {
  if (timer) return timer;

  // Run once after 5s startup delay to catch up if needed
  startupTimer = setTimeout(() => {
    startupTimer = null;
    return runs.track(runOnce().catch((error) => logger.warn('monthly_leave_accrual_initial_run_failed', { error: error.message || error })));
  }, 5000);
  startupTimer.unref?.();

  // Check periodically every hour
  timer = setInterval(() => {
    return runs.track(runOnce().catch((error) => logger.warn('monthly_leave_accrual_periodic_run_failed', { error: error.message || error })));
  }, CHECK_INTERVAL_MS);
  timer.unref?.();

  logger.info('monthly_leave_accrual_scheduler_started', {
    intervalMs: CHECK_INTERVAL_MS,
  });
  return timer;
}

function stopMonthlyLeaveAccrualScheduler() {
  clearTimeout(startupTimer);
  startupTimer = null;
  if (!timer) return runs.drain();
  clearInterval(timer);
  timer = null;
  return runs.drain();
}

module.exports = {
  getCurrentVietnamMonthYear,
  runOnce,
  startMonthlyLeaveAccrualScheduler,
  stopMonthlyLeaveAccrualScheduler,
};
