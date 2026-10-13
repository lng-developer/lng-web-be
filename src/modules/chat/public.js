const service = require('./services/chat.service');
const chatEvents = require('./events');

module.exports = {
  canReadConversation: service.canReadConversation,
  createConversation: service.createConversation,
  findDirectConversation: service.findDirectConversation,
  getConversationById: service.getConversationById,
  listMessages: service.listMessages,
  sendMessage: service.sendMessage,
  markRead: service.markRead,
  chatEvents,
  routeContracts: [
    '/api/chat/conversations',
    '/api/chat/conversations/:conversationId/messages',
    '/api/chat/conversations/:conversationId/read',
  ],
};
