const logger = require('../../../shared/utils/logger');
const shipmentService = require('./shipment.service');

let timer = null;
let running = false;

function isEnabled() {
  return String(process.env.VENDOR_TRACKING_RECHECK_ENABLED || '').toLowerCase() === 'true';
}

function intervalMs() {
  return Math.max(Number(process.env.VENDOR_TRACKING_RECHECK_INTERVAL_MS) || 15 * 60 * 1000, 60 * 1000);
}

function limit() {
  return Math.min(Math.max(Number(process.env.VENDOR_TRACKING_RECHECK_LIMIT) || 50, 1), 100);
}

async function runOnce() {
  if (running) return null;
  running = true;
  try {
    const result = await shipmentService.recheckSubmittedVendorTracking({
      limit: limit(),
    }, {
      system: true,
      source: 'VENDOR_TRACKING_RECHECK_SCHEDULER',
    });
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

function startVendorTrackingRecheckScheduler() {
  if (!isEnabled() || timer) return null;
  timer = setInterval(runOnce, intervalMs());
  timer.unref?.();
  logger.info('vendor_tracking_recheck_scheduler_started', {
    intervalMs: intervalMs(),
    limit: limit(),
  });
  return timer;
}

function stopVendorTrackingRecheckScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  runOnce,
  startVendorTrackingRecheckScheduler,
  stopVendorTrackingRecheckScheduler,
};
