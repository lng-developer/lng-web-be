const logger = require('../../../shared/utils/logger');
const shipmentService = require('./shipment.service');
const trackingSyncConfigService = require('./trackingSyncConfig.service');
const { withDistributedLock } = require('../../../shared/utils/distributedLock');

const config = require('../../../config');
const trackingQueue = require('./vendorTrackingQueue.service');
const DISPATCH_INTERVAL_MS = 30000;
let activeRun;
let refresh;
let timer = null;
let running = false;

function runOnce(authContext = { system: true, source: 'VENDOR_TRACKING_RECHECK_SCHEDULER' }) {
  if (activeRun) return Promise.resolve(null);
  activeRun = execute(authContext).finally(() => { activeRun = null; });
  return activeRun;
}

async function execute(authContext) {
  if (running) return null;
  return withDistributedLock('scheduler:vendor_tracking_recheck', 120000, async () => {
    if (running) return null;
    running = true;
    const startedAt = new Date();
    try {
      const settings = await trackingSyncConfigService.get();
      const queuedDiscovery = config.shipment?.trackingQueueEnabled && authContext.system === true
        && authContext.source === 'VENDOR_TRACKING_RECHECK_SCHEDULER';
      const result = queuedDiscovery ? await trackingQueue.discoverAndEnqueue(settings.batchSize)
        : await shipmentService.recheckSubmittedVendorTracking({
        limit: settings.batchSize,
        perVendor: true,
      }, {
        ...authContext,
        system: authContext.system ?? true,
        source: authContext.source || 'VENDOR_TRACKING_RECHECK_SCHEDULER',
      });
      const finishedAt = new Date();
      await trackingSyncConfigService.recordRun(result, authContext, { startedAt, finishedAt });
      logger.info('vendor_tracking_recheck_completed', {
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        checked: result.checked,
        applied: result.applied,
        skipped: result.skipped,
        failed: result.failed,
      });
      return result;
    } catch (error) {
      const finishedAt = new Date();
      logger.warn('vendor_tracking_recheck_failed', {
        error, startedAt, finishedAt, durationMs: Math.max(0, finishedAt - startedAt),
      });
      return null;
    } finally {
      running = false;
    }
  });
}

function schedule(settings) {
  if (timer) clearInterval(timer);
  timer = null;
  if (!settings.enabled) return null;
  const intervalMs = config.shipment?.trackingQueueEnabled ? DISPATCH_INTERVAL_MS : settings.intervalMinutes * 60000;
  timer = setInterval(() => {
    runOnce().catch((error) => logger.warn('vendor_tracking_recheck_failed', { error }));
  }, intervalMs);
  timer.unref?.();
  logger.info('vendor_tracking_recheck_scheduler_started', {
    intervalMs,
    limit: settings.batchSize,
  });
  return timer;
}

async function startVendorTrackingRecheckScheduler() {
  if (timer) return timer;
  if (config.runtime?.role === 'scheduler') {
    async function refreshSettings() {
      try {
        const settings = await trackingSyncConfigService.get();
        const lastRun = settings.lastRunAt ? new Date(settings.lastRunAt).getTime() : 0;
        const due = config.shipment?.trackingQueueEnabled || Date.now() - lastRun >= settings.intervalMinutes * 60000;
        if (timer && settings.enabled && due) await runOnce();
      } catch (error) {
        logger.warn('vendor_tracking_recheck_failed', { error });
      }
    }
    timer = setInterval(() => {
      refresh ||= refreshSettings().finally(() => { refresh = null; });
    }, config.shipment?.trackingQueueEnabled ? DISPATCH_INTERVAL_MS : 60000);
    timer.unref?.();
    return timer;
  }
  try {
    return schedule(await trackingSyncConfigService.get());
  } catch (error) {
    logger.warn('vendor_tracking_recheck_scheduler_start_failed', { error });
    return null;
  }
}

function applyTrackingSyncConfig(settings) {
  if (config.runtime?.role && config.runtime.role !== 'combined') return null;
  return schedule(settings);
}

function stopVendorTrackingRecheckScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  return Promise.all([refresh, activeRun]);
}

module.exports = {
  applyTrackingSyncConfig,
  runOnce,
  startVendorTrackingRecheckScheduler,
  stopVendorTrackingRecheckScheduler,
};
