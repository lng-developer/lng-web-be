const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');
const emailImportService = require('./amazonAdsEmailImport.service');

function createAmazonAdsEmailImportScheduler(settings = config.amazonAdsGmail, dependencies = {}) {
  const runOnce = dependencies.runOnce || emailImportService.runOnce;
  const schedule = dependencies.setInterval || setInterval;
  const cancel = dependencies.clearInterval || clearInterval;
  const log = dependencies.logger || logger;
  let timer = null;
  let running = false;

  async function run() {
    if (running) return null;
    running = true;
    try {
      return await runOnce();
    } catch (error) {
      log.warn('amazon_ads_gmail_import_failed', { message: error.message });
      return null;
    } finally {
      running = false;
    }
  }

  function start() {
    if (!settings.enabled || timer) return null;
    timer = schedule(run, settings.pollIntervalMs);
    timer.unref?.();
    void run();
    log.info('amazon_ads_gmail_import_scheduler_started', { intervalMs: settings.pollIntervalMs });
    return timer;
  }

  function stop() {
    if (!timer) return;
    cancel(timer);
    timer = null;
  }

  return { run, start, stop };
}

const scheduler = createAmazonAdsEmailImportScheduler();

module.exports = {
  createAmazonAdsEmailImportScheduler,
  runAmazonAdsEmailImportOnce: scheduler.run,
  startAmazonAdsEmailImportScheduler: scheduler.start,
  stopAmazonAdsEmailImportScheduler: scheduler.stop,
};
