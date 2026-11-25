const { createScheduledRunTracker } = require('../../../../shared/utils/scheduledRunTracker');
const logger = require('../../../../shared/utils/logger');
const service = require('./extensionCommand.service');
const { withDistributedLock } = require('../../../../shared/utils/distributedLock');

let timer;
const runs = createScheduledRunTracker();

function runOnce() {
  return withDistributedLock('scheduler:extension_order_schedule', 60000, async () => {
    const results = await Promise.allSettled([
      service.dispatchDueOrderSchedules(),
      service.dispatchDueFinanceSchedules(),
      service.dispatchDueTrackingSchedules(),
      require('../../listingImageSync/public').dispatch(),
    ]);
    const failure = results.find(({ status }) => status === 'rejected');
    if (failure) throw failure.reason;
  }).catch((error) => logger.error('extension_schedule_dispatch_failed', { error }));
}

function startExtensionOrderScheduleScheduler() {
  if (timer) return;
  timer = setInterval(() => runs.track(runOnce()), 60 * 1000);
  runs.track(runOnce());
}

function stopExtensionOrderScheduleScheduler() {
  if (!timer) return runs.drain();
  clearInterval(timer);
  timer = null;
  return runs.drain();
}

module.exports = { startExtensionOrderScheduleScheduler, stopExtensionOrderScheduleScheduler };
