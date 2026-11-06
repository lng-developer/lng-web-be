const { Server } = require('socket.io');
const config = require('../config');
const authPublic = require('../modules/auth/public');
const chatEvents = require('../modules/chat/events');
const chatService = require('../modules/chat/services/chat.service');
const schemas = require('../modules/chat/validators/chat.validator');
const presenceRegistry = require('./presenceRegistry');
const socketMetrics = require('./socketMetrics');
const logger = require('../shared/utils/logger');
let createAdapter;
try {
  ({ createAdapter } = require('@socket.io/redis-adapter'));
} catch (e) {
  /* optional redis adapter */
}
const { getRedisClient } = require('../config/redis');

function getToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return String(authToken);
  const header = socket.handshake.headers?.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

async function authenticateSocket(socket, next) {
  try {
    const token = getToken(socket);
    if (!token) throw new Error('Authentication required');
    const payload = authPublic.verifyAccessToken(token);
    const authModel = await authPublic.getCurrentAccount(payload.sub, payload.tokenVersion ?? 0);
    socket.authContext = authPublic.buildAuthContext(authModel);
    if (socket.authContext.mustChangePassword || socket.authContext.passwordSetupRequired) {
      throw new Error('Account setup required');
    }
    next();
  } catch (error) {
    socketMetrics.recordAuthFailure(error);
    next(error);
  }
}

function ackError(ack, error) {
  socketMetrics.recordEventFailure(error);
  logger.warn('chat_socket_event_failed', { errorCode: error.code || null, error });
  if (typeof ack === 'function') ack({ ok: false, error: error.message || 'Request failed' });
}

function validate(schema, payload) {
  const { value, error } = schemas.validate(schema, payload);
  if (error) throw error;
  return value;
}

function attachChatSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: config.http.corsOrigins,
      credentials: true,
    },
  });

  let pubClient;
  let subClient;

  if (config.redis?.enabled && typeof io.adapter === 'function' && typeof createAdapter === 'function') {
    try {
      const baseRedis = getRedisClient();
      pubClient = baseRedis.duplicate();
      subClient = baseRedis.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('chat_socket_redis_adapter_attached');
    } catch (error) {
      logger.warn('chat_socket_redis_adapter_attach_failed', { error: error.message });
    }
  }

  socketMetrics.attachIo(io);
  io.use(authenticateSocket);
  const broadcastCreatedMessage = ({ conversation, message }) => {
    const rooms = [
      ...(conversation?.participantAccountIds || []).map((participantId) => `account:${participantId}`),
      `conversation:${message.conversationId}`,
    ];
    io.to(rooms).emit('message.created', { conversation, message });
  };
  chatEvents.on('message.created', broadcastCreatedMessage);
  const broadcastRead = (state) => io.to([
    `account:${state.accountId}`, `conversation:${state.conversationId}`,
  ]).emit('message.read', state);
  chatEvents.on('message.read', broadcastRead);
  io.on('connection', (socket) => {
    const accountId = socket.authContext.accountId;
    socketMetrics.recordConnection(accountId);
    socket.join(`account:${accountId}`);
    socket.join('presence');
    const connectedPresence = presenceRegistry.connect(accountId);
    if (connectedPresence) {
      io.to('presence').emit('presence.changed', { accountId, presence: connectedPresence });
    }

    socket.on('disconnect', () => {
      socketMetrics.recordDisconnect(accountId);
      const disconnectedPresence = presenceRegistry.disconnect(accountId);
      if (disconnectedPresence) {
        io.to('presence').emit('presence.changed', { accountId, presence: disconnectedPresence });
      }
    });

    socket.on('conversation.join', async ({ conversationId } = {}, ack) => {
      try {
        await chatService.listMessages(conversationId, { limit: 1 }, socket.authContext);
        socket.join(`conversation:${conversationId}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('message.send', async ({ conversationId, ...payload } = {}, ack) => {
      try {
        const validated = validate(schemas.sendMessageSchema, payload);
        const message = await chatService.sendMessage(
          conversationId,
          validated,
          socket.authContext,
        );
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('message.read', async ({ conversationId } = {}, ack) => {
      try {
        const state = await chatService.markRead(conversationId, socket.authContext);
        if (typeof ack === 'function') ack({ ok: true, state });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('typing', ({ conversationId, isTyping } = {}) => {
      if (!conversationId) return;
      socket.to(`conversation:${conversationId}`).emit('typing', {
        conversationId,
        accountId: socket.authContext.accountId,
        isTyping: Boolean(isTyping),
      });
    });
  });

  const originalClose = io.close.bind(io);
  io.close = (...args) => {
    chatEvents.off('message.created', broadcastCreatedMessage);
    chatEvents.off('message.read', broadcastRead);
    if (pubClient) {
      try { pubClient.quit(); } catch { /* ignore */ }
      pubClient = undefined;
    }
    if (subClient) {
      try { subClient.quit(); } catch { /* ignore */ }
      subClient = undefined;
    }
    return originalClose(...args);
  };

  return io;
}

module.exports = { attachChatSocket };
