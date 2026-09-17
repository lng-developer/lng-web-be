const logger = require('../../../../shared/utils/logger');
const service = require('./extensionCommand.service');

let timer;

function runOnce() {
  return Promise.all([
    service.dispatchDueOrderSchedules(),
    service.dispatchDueFinanceSchedules(),
    require('../../listingImageSync/public').dispatch(),
  ]).catch((error) => logger.error('extension_schedule_dispatch_failed', { error }));
}

function startExtensionOrderScheduleScheduler() {
  if (timer) return;
  timer = setInterval(runOnce, 60 * 1000);
  runOnce();
}

function stopExtensionOrderScheduleScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { startExtensionOrderScheduleScheduler, stopExtensionOrderScheduleScheduler };
