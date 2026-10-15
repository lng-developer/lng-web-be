const chatPublic = require('../../../chat/public');
const outboxService = require('./teamsOutboundOutbox.service');
const logger = require('../../../../shared/utils/logger');

let isAttached = false;

async function handleMessageCreated({ conversation, message, source }) {
  try {
    if (source === 'TEAMS_INBOUND') return;
    if (conversation?.type !== 'DIRECT') return;
    await outboxService.enqueue({ conversation, message });
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
