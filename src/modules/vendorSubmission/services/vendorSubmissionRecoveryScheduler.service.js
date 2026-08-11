const logger = require('../../../shared/utils/logger');
const vendorSubmissionPublic = require('../public');

let timer = null;
let running = false;

function isEnabled() {
  return String(process.env.VENDOR_SUBMISSION_RECOVERY_ENABLED || '').toLowerCase() === 'true';
}

function intervalMs() {
  return Math.max(Number(process.env.VENDOR_SUBMISSION_RECOVERY_INTERVAL_MS) || 5 * 60 * 1000, 60 * 1000);
}

function limit() {
  return Math.min(Math.max(Number(process.env.VENDOR_SUBMISSION_RECOVERY_LIMIT) || 50, 1), 100);
}

async function runOnce() {
  if (running) return null;
  running = true;
  try {
    const result = await vendorSubmissionPublic.recheckReadyProductionTasks(
      { limit: limit() },
      { system: true, source: 'VENDOR_SUBMISSION_RECOVERY_SCHEDULER' },
    );
    const level = result.checked || result.createdOrExisting || result.skipped ? 'info' : 'debug';
    logger[level]('vendor_submission_recovery_completed', result);
    return result;
  } catch (error) {
    logger.warn('vendor_submission_recovery_failed', { error });
    return null;
  } finally {
    running = false;
  }
}

function startVendorSubmissionRecoveryScheduler() {
  if (!isEnabled() || timer) return null;
  timer = setInterval(runOnce, intervalMs());
  timer.unref?.();
  logger.info('vendor_submission_recovery_scheduler_started', { intervalMs: intervalMs(), limit: limit() });
  return timer;
}

function stopVendorSubmissionRecoveryScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, startVendorSubmissionRecoveryScheduler, stopVendorSubmissionRecoveryScheduler };
