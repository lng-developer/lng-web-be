const outbox = require('./teamsOutboundOutbox.service');
const config = require('../../../../config');
const { createScheduledRunTracker } = require('../../../../shared/utils/scheduledRunTracker');

const runs = createScheduledRunTracker();
let timer = null;

function startTeamsOutboundOutboxScheduler() {
  if (!config.teams.outboxEnabled || timer) return;
  const tick = () => runs.track(outbox.runSafely());
  tick();
  timer = setInterval(tick, 5000);
  timer.unref?.();
}

function stopTeamsOutboundOutboxScheduler() {
  clearInterval(timer);
  timer = null;
  return runs.drain();
}

module.exports = { startTeamsOutboundOutboxScheduler, stopTeamsOutboundOutboxScheduler };
