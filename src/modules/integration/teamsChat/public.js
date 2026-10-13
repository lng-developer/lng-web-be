const teamsSyncService = require('./services/teamsSync.service');
const teamsOutboundListener = require('./services/teamsOutboundListener');
const graphClient = require('./services/microsoftGraphClient');

const teamsSubscriptionScheduler = require('./services/teamsSubscriptionScheduler.service');

module.exports = {
  dispatchMessageToTeams: teamsSyncService.dispatchMessageToTeams,
  processInboundWebhookNotification: teamsSyncService.processInboundWebhookNotification,
  linkUserWithEntra: teamsSyncService.linkUserWithEntra,
  resolveUserEntraId: teamsSyncService.resolveUserEntraId,
  resolveAccountForEntraUser: teamsSyncService.resolveAccountForEntraUser,
  resolveTeamsChat: teamsSyncService.resolveTeamsChat,
  ensureWebhookSubscription: teamsSyncService.ensureWebhookSubscription,
  startTeamsSubscriptionScheduler: teamsSubscriptionScheduler.startTeamsSubscriptionScheduler,
  stopTeamsSubscriptionScheduler: teamsSubscriptionScheduler.stopTeamsSubscriptionScheduler,
  attachTeamsOutboundListener: teamsOutboundListener.attachTeamsOutboundListener,
  detachTeamsOutboundListener: teamsOutboundListener.detachTeamsOutboundListener,
  setMockGraphHandler: graphClient.setMockGraphHandler,
  clearMockGraphHandler: graphClient.clearMockGraphHandler,
};
