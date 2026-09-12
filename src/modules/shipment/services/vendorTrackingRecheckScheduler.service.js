const logger = require('../../../shared/utils/logger');
const shipmentService = require('./shipment.service');
const trackingSyncConfigService = require('./trackingSyncConfig.service');

let timer = null;
let running = false;

async function runOnce(authContext = { system: true, source: 'VENDOR_TRACKING_RECHECK_SCHEDULER' }) {
  if (running) return null;
  running = true;
  try {
    const settings = await trackingSyncConfigService.get();
    const result = await shipmentService.recheckSubmittedVendorTracking({
      limit: settings.batchSize,
    }, {
      ...authContext,
      system: authContext.system ?? true,
      source: authContext.source || 'VENDOR_TRACKING_RECHECK_SCHEDULER',
    });
    await trackingSyncConfigService.recordRun(result, authContext);
    logger.info('vendor_tracking_recheck_completed', {
      checked: result.checked,
      applied: result.applied,
      skipped: result.skipped,
      failed: result.failed,
    });
    return result;
  } catch (error) {
    logger.warn('vendor_tracking_recheck_failed', { error });
    return null;
  } finally {
    running = false;
  }
}

function schedule(settings) {
  if (timer) clearInterval(timer);
  timer = null;
  if (!settings.enabled) return null;
  timer = setInterval(() => {
    runOnce().catch((error) => logger.warn('vendor_tracking_recheck_failed', { error }));
  }, settings.intervalMinutes * 60_000);
  timer.unref?.();
  logger.info('vendor_tracking_recheck_scheduler_started', {
    intervalMs: settings.intervalMinutes * 60_000,
    limit: settings.batchSize,
  });
  return timer;
}

async function startVendorTrackingRecheckScheduler() {
  if (timer) return timer;
  try {
    return schedule(await trackingSyncConfigService.get());
  } catch (error) {
    logger.warn('vendor_tracking_recheck_scheduler_start_failed', { error });
    return null;
  }
}

function applyTrackingSyncConfig(settings) {
  return schedule(settings);
}

function stopVendorTrackingRecheckScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  applyTrackingSyncConfig,
  runOnce,
  startVendorTrackingRecheckScheduler,
  stopVendorTrackingRecheckScheduler,
};
