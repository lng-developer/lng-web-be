const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const hrPublic = require('../../hr/public');
const mediaPublic = require('../../media/public');
const notificationPublic = require('../../notification/public');
const chatEvents = require('../events');
const conversationRepository = require('../repositories/conversation.repository');
const messageRepository = require('../repositories/message.repository');
const { toConversationDto, toConversationListDto, toMessageDto, toMessageListDto } = require('../dtos/chat.dto');
const {
  chatReadablePermissions,
  chatWritablePermissions,
} = require('../constants/chat.constants');

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function notFound(resource) {
  return new AppError(`${resource} not found`, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function uniqueIds(values = []) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function directKeyFor(accountIds = []) {
  return uniqueIds(accountIds).sort().join(':');
}

function canAccessShop(authContext = {}, shopId, permissions) {
  if (!shopId) return true;
  return permissions.some((permission) => authPublic.canAccessScope(
    authContext,
    permission,
    { scopeType: 'shop', scopeId: shopId },
  ));
}

function canAccessConversation(conversation, authContext = {}, permissions) {
  const accountId = String(authContext.accountId || '');
  const participants = (conversation.participantAccountIds || []).map(String);
  const isParticipant = participants.length === 0 || participants.includes(accountId);
  return isParticipant && canAccessShop(authContext, conversation.shopId, permissions);
}

async function loadConversation(conversationId, authContext, permissions) {
  assertValidObjectId(conversationId, 'conversationId');
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) throw notFound('Conversation');
  if (!canAccessConversation(conversation, authContext, permissions)) throw forbidden();
  return conversation;
}

async function canReadConversation(conversationId, authContext = {}) {
  try {
    await loadConversation(conversationId, authContext, chatReadablePermissions);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listConversations(query = {}, authContext = {}) {
  const result = await conversationRepository.listForAccount(authContext.accountId, query);
  const states = await messageRepository.summarizeConversationStates(
    result.items.map((conversation) => conversation._id),
    authContext.accountId,
  );
  return toConversationListDto({
    ...result,
    items: result.items.map((conversation) => ({
      ...conversation,
      ...states.get(String(conversation._id)),
    })),
  });
}

async function listParticipants(query = {}, authContext = {}, onlineAccountIds = new Set()) {
  const result = await authPublic.listChatDirectory(query);
  const profiles = await hrPublic.listEmployeeProfilesByAccountIds((result.items || []).map((account) => account.id));
  const profilesByAccountId = new Map(profiles.map((profile) => [String(profile.accountId), profile]));
  const currentAccountId = String(authContext.accountId || '');
  return {
    ...result,
    items: (result.items || [])
      .filter((account) => String(account.id) !== currentAccountId)
      .map((account) => ({
        ...account,
        employeeCode: profilesByAccountId.get(String(account.id))?.employeeCode || null,
        presence: onlineAccountIds.has(String(account.id)) ? 'ONLINE' : 'OFFLINE',
      }))
      .sort((left, right) => {
        if (left.presence !== right.presence) return left.presence === 'ONLINE' ? -1 : 1;
        return String(left.employeeCode || left.email || '').localeCompare(String(right.employeeCode || right.email || ''));
      }),
  };
}

async function createConversation(payload = {}, authContext = {}) {
  const participantAccountIds = uniqueIds([
    authContext.accountId,
    ...(payload.participantAccountIds || []),
  ]);
  if (payload.shopId && !canAccessShop(authContext, payload.shopId, chatWritablePermissions)) throw forbidden();
  const directKey = payload.type === 'DIRECT' ? directKeyFor(participantAccountIds) : null;
  if (directKey) {
    const existing = await conversationRepository.findByDirectKey(directKey);
    if (existing) return toConversationDto(existing);
  }

  return toConversationDto(await conversationRepository.create({
    type: payload.type,
    title: payload.title || null,
    shopId: payload.shopId || null,
    relatedResource: payload.relatedResource || null,
    participantAccountIds,
    directKey,
    createdBy: authContext.accountId || null,
  }));
}

async function listMessages(conversationId, query = {}, authContext = {}) {
  await loadConversation(conversationId, authContext, chatReadablePermissions);
  const result = await messageRepository.listByConversation(conversationId, query);
  const ids = (result.items || []).flatMap((message) => message.assetIds || []);
  return toMessageListDto(result, await assetsById(ids));
}

async function assertAssetsReady(assetIds = []) {
  const ids = uniqueIds(assetIds);
  await Promise.all(ids.map((assetId) => mediaPublic.assertMediaAssetReady(assetId)));
  return ids;
}

async function assetsById(assetIds = []) {
  const ids = uniqueIds(assetIds);
  if (!ids.length) return new Map();
  const assets = await mediaPublic.getAssetsByIds(ids);
  return new Map((assets || []).map((asset) => [toId(asset), asset]));
}

async function sendMessage(conversationId, payload = {}, authContext = {}) {
  const conversation = await loadConversation(conversationId, authContext, chatWritablePermissions);
  const assetIds = await assertAssetsReady(payload.assetIds);
  if (assetIds.length) await mediaPublic.attachAssetsToChat(assetIds, conversationId);
  const mentions = uniqueIds(payload.mentions);
  const message = await messageRepository.create({
    conversationId,
    senderAccountId: authContext.accountId,
    body: payload.body || '',
    assetIds,
    mentions,
    replyToMessageId: payload.replyToMessageId || null,
  });
  const updatedConversation = await conversationRepository.updateLastMessage(conversationId, message);

  const senderId = String(authContext.accountId || '');
  await Promise.all(mentions.filter((id) => id !== senderId).map((recipientAccountId) => notificationPublic.notify({
    recipientAccountId,
    type: 'CHAT_MENTION',
    title: 'Chat mention',
    message: 'You were mentioned in a conversation.',
    relatedResource: { type: 'chatConversation', id: toId(conversation) },
    deduplicationKey: `CHAT_MENTION:${toId(message)}:${recipientAccountId}`,
  })));

  const messageDto = toMessageDto(message, await assetsById(assetIds));
  chatEvents.emit('message.created', {
    conversation: toConversationDto(updatedConversation || conversation),
    message: messageDto,
  });
  return messageDto;
}

async function markRead(conversationId, authContext = {}) {
  await loadConversation(conversationId, authContext, chatReadablePermissions);
  const readState = await messageRepository.markRead(conversationId, authContext.accountId, new Date());
  return {
    conversationId: toId(readState.conversationId),
    accountId: toId(readState.accountId),
    lastReadAt: readState.lastReadAt,
  };
}

module.exports = {
  canReadConversation,
  createConversation,
  listConversations,
  listParticipants,
  listMessages,
  markRead,
  sendMessage,
};
