const service = require('./services/chat.service');

module.exports = {
  canReadConversation: service.canReadConversation,
  createConversation: service.createConversation,
  sendMessage: service.sendMessage,
  markRead: service.markRead,
  routeContracts: [
    '/api/chat/conversations',
    '/api/chat/conversations/:conversationId/messages',
    '/api/chat/conversations/:conversationId/read',
  ],
};
