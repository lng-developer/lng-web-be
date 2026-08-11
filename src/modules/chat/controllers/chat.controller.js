const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/chat.service');
const schemas = require('../validators/chat.validator');
const presenceRegistry = require('../../../realtime/presenceRegistry');

function assertValid(schema, payload) {
  const { value, error } = schemas.validate(schema, payload);
  if (error) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, error.details);
  }
  return value;
}

async function listConversations(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listConversations(assertValid(schemas.listSchema, req.query), req.auth),
  });
}

async function listParticipants(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listParticipants(
      assertValid(schemas.listParticipantsSchema, req.query),
      req.auth,
      presenceRegistry.onlineAccountIds(),
    ),
  });
}

async function createConversation(req, res) {
  const conversation = await service.createConversation(
    assertValid(schemas.createConversationSchema, req.body),
    req.auth,
  );
  res.location(`/api/chat/conversations/${conversation.id}`);
  res.status(httpStatus.CREATED).json({ success: true, data: conversation });
}

async function listMessages(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listMessages(
      req.params.conversationId,
      assertValid(schemas.listSchema, req.query),
      req.auth,
    ),
  });
}

async function sendMessage(req, res) {
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.sendMessage(
      req.params.conversationId,
      assertValid(schemas.sendMessageSchema, req.body),
      req.auth,
    ),
  });
}

async function markRead(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markRead(req.params.conversationId, req.auth),
  });
}

module.exports = {
  createConversation,
  listConversations,
  listParticipants,
  listMessages,
  markRead,
  sendMessage,
};
