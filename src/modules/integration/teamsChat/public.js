const teamsSyncService = require('./services/teamsSync.service');
require('./models/teamsOAuthState.model');
require('./models/teamsOutboundMessage.model');
const teamsOutboundListener = require('./services/teamsOutboundListener');
const graphClient = require('./services/microsoftGraphClient');

const teamsSubscriptionScheduler = require('./services/teamsSubscriptionScheduler.service');
const teamsOAuthService = require('./services/teamsOAuth.service');
const teamsOutboundOutboxScheduler = require('./services/teamsOutboundOutboxScheduler.service');

module.exports = {
  dispatchMessageToTeams: teamsSyncService.dispatchMessageToTeams,
  processInboundWebhookNotification: teamsSyncService.processInboundWebhookNotification,
  linkUserWithEntra: teamsSyncService.linkUserWithEntra,
  resolveUserEntraId: teamsSyncService.resolveUserEntraId,
  resolveAccountForEntraUser: teamsSyncService.resolveAccountForEntraUser,
  resolveTeamsChat: teamsSyncService.resolveTeamsChat,
  ensureWebhookSubscription: teamsSyncService.ensureWebhookSubscription,
  syncInboundMessagesForConversation: teamsSyncService.syncInboundMessagesForConversation,
  startTeamsSubscriptionScheduler: teamsSubscriptionScheduler.startTeamsSubscriptionScheduler,
  stopTeamsSubscriptionScheduler: teamsSubscriptionScheduler.stopTeamsSubscriptionScheduler,
  attachTeamsOutboundListener: teamsOutboundListener.attachTeamsOutboundListener,
  detachTeamsOutboundListener: teamsOutboundListener.detachTeamsOutboundListener,
  setMockGraphHandler: graphClient.setMockGraphHandler,
  clearMockGraphHandler: graphClient.clearMockGraphHandler,
  startOAuth: teamsOAuthService.startAuthorization,
  startTeamsOutboundOutboxScheduler: teamsOutboundOutboxScheduler.startTeamsOutboundOutboxScheduler,
  stopTeamsOutboundOutboxScheduler: teamsOutboundOutboxScheduler.stopTeamsOutboundOutboxScheduler,
};
