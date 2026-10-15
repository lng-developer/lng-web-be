const outbox = require('./teamsOutboundOutbox.service');
const config = require('../../../../config');
let timer = null;
function startTeamsOutboundOutboxScheduler() { if (config.teams.outboxEnabled && !timer) { outbox.runSafely(); timer = setInterval(outbox.runSafely, 5000); timer.unref?.(); } }
function stopTeamsOutboundOutboxScheduler() { if (timer) clearInterval(timer); timer = null; }
module.exports = { startTeamsOutboundOutboxScheduler, stopTeamsOutboundOutboxScheduler };
