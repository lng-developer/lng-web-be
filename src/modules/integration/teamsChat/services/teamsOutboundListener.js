const chatPublic = require('../../../chat/public');
const outboxService = require('./teamsOutboundOutbox.service');
const teamsSyncService = require('./teamsSync.service');
const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');

let isAttached = false;

async function handleMessageCreated({ conversation, message, source }) {
  try {
    if (source === 'TEAMS_INBOUND') return;
    if (conversation?.type !== 'DIRECT') return;
    if (config.teams.outboxEnabled) await outboxService.enqueue({ conversation, message });
    else await teamsSyncService.dispatchMessageToTeams({ conversation, message });
  } catch (error) {
    logger.warn('teams_outbound_listener_error', {
      conversationId: conversation?.id,
      messageId: message?.id,
      error: error.message,
    });
  }
}

function attachTeamsOutboundListener() {
  if (isAttached) return;
  chatPublic.chatEvents.on('message.created', handleMessageCreated);
  isAttached = true;
}

function detachTeamsOutboundListener() {
  if (!isAttached) return;
  chatPublic.chatEvents.off('message.created', handleMessageCreated);
  isAttached = false;
}

module.exports = {
  handleMessageCreated,
  attachTeamsOutboundListener,
  detachTeamsOutboundListener,
};
