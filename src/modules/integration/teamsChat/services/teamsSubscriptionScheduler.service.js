const { createScheduledRunTracker } = require('../../../../shared/utils/scheduledRunTracker');
const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');
const teamsSyncService = require('./teamsSync.service');
const { withDistributedLock } = require('../../../../shared/utils/distributedLock');

const RENEW_CHECK_INTERVAL_MS = 10 * 60 * 1000; // Check every 10 minutes

let intervalId = null;
const runs = createScheduledRunTracker();

function startTeamsSubscriptionScheduler() {
  if (intervalId || !config.teams.enabled || !config.teams.webhookUrl) return;

  // Run initial check asynchronously
  runs.track(teamsSyncService.ensureWebhookSubscription().then((result) => {
    logger.info('teams_subscription_scheduler_initialized', { status: result?.status });
  }).catch((err) => {
    logger.warn('teams_subscription_scheduler_init_failed', { error: err.message });
  }));

  intervalId = setInterval(() => {
    return runs.track(withDistributedLock('scheduler:teams_subscription', 300000, async () => {
      try {
        const res = await teamsSyncService.ensureWebhookSubscription();
        logger.info('teams_subscription_scheduler_tick', { status: res?.status });
      } catch (error) {
        logger.warn('teams_subscription_scheduler_tick_failed', { error: error.message });
      }
    }));
  }, RENEW_CHECK_INTERVAL_MS);

  if (typeof intervalId.unref === 'function') {
    intervalId.unref();
  }

  logger.info('teams_subscription_scheduler_started', { intervalMs: RENEW_CHECK_INTERVAL_MS });
}

function stopTeamsSubscriptionScheduler() {
  if (!intervalId) return runs.drain();
  clearInterval(intervalId);
  intervalId = null;
  logger.info('teams_subscription_scheduler_stopped');
  return runs.drain();
}

module.exports = {
  startTeamsSubscriptionScheduler,
  stopTeamsSubscriptionScheduler,
};
