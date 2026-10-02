const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');
const authPublic = require('../../../auth/public');
const chatPublic = require('../../../chat/public');
const notificationPublic = require('../../../notification/public');
const {
  TEAMS_SYNC_DIRECTIONS,
  TEAMS_SYNC_STATUSES,
  TEAMS_USER_TYPES,
  TEAMS_NOTIFICATION_TYPES,
} = require('../constants/teams.constants');
const teamsUserMappingRepository = require('../repositories/teamsUserMapping.repository');
const teamsChatMappingRepository = require('../repositories/teamsChatMapping.repository');
const teamsMessageMappingRepository = require('../repositories/teamsMessageMapping.repository');
const teamsSubscriptionRepository = require('../repositories/teamsSubscription.repository');
const cryptoService = require('./crypto.service');
const graphClient = require('./microsoftGraphClient');

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parseResource(resource = '') {
  const chatMatch = resource.match(/chats\('([^']+)'\)/) || resource.match(/chats\/([^/]+)/);
  const messageMatch = resource.match(/messages\('([^']+)'\)/) || resource.match(/messages\/([^/]+)/);

  return {
    teamsChatId: chatMatch ? chatMatch[1] : null,
    teamsMessageId: messageMatch ? messageMatch[1] : null,
  };
}

async function linkUserWithEntra({ accountId, entraUserId, email, displayName, userType = TEAMS_USER_TYPES.INTERNAL, tenantId = null, refreshToken = null }) {
  const encryptedRefreshToken = refreshToken ? cryptoService.encrypt(refreshToken) : undefined;
  return teamsUserMappingRepository.upsertMapping({
    accountId,
    entraUserId,
    email: email.toLowerCase().trim(),
    displayName: displayName || null,
    userType,
    tenantId,
    ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
  });
}

async function resolveUserEntraId(accountId) {
  if (!accountId) return null;
  const existing = await teamsUserMappingRepository.findByAccountId(accountId);
  if (existing?.entraUserId) return existing.entraUserId;

  const current = await authPublic.getCurrentAccount(accountId);
  if (current?.account?.microsoftId) {
    await teamsUserMappingRepository.upsertMapping({
      accountId: current.account.id,
      entraUserId: current.account.microsoftId,
      email: current.account.email,
    });
    return current.account.microsoftId;
  }
  return null;
}

async function resolveAccountForEntraUser({ entraUserId, email, displayName, tenantId = null, userType = TEAMS_USER_TYPES.INTERNAL }) {
  if (entraUserId) {
    const existing = await teamsUserMappingRepository.findByEntraUserId(entraUserId);
    if (existing?.accountId) return existing.accountId;
  }

  const account = await authPublic.ensureTeamsAccount({
    entraUserId,
    email,
    displayName,
    isExternal: userType === TEAMS_USER_TYPES.EXTERNAL || userType === TEAMS_USER_TYPES.GUEST,
  });

  if (account?.id && entraUserId) {
    await teamsUserMappingRepository.upsertMapping({
      accountId: account.id,
      entraUserId,
      email: account.email || email,
      displayName,
      userType,
      tenantId,
    });
    return account.id;
  }

  return account?.id || null;
}

async function resolveTeamsChat({ conversationId, participantAccountIds = [] }) {
  const existingMapping = await teamsChatMappingRepository.findByConversationId(conversationId);
  if (existingMapping?.teamsChatId) return existingMapping.teamsChatId;

  if (participantAccountIds.length !== 2) return null;

  const [entraId1, entraId2] = await Promise.all([
    resolveUserEntraId(participantAccountIds[0]),
    resolveUserEntraId(participantAccountIds[1]),
  ]);

  if (!entraId1 || !entraId2) {
    logger.debug('cannot_resolve_teams_chat_missing_entra_ids', {
      conversationId,
      hasEntraId1: Boolean(entraId1),
      hasEntraId2: Boolean(entraId2),
    });
    return null;
  }

  const existingByParticipants = await teamsChatMappingRepository.findByParticipantEntraUserIds(entraId1, entraId2);
  if (existingByParticipants?.teamsChatId) {
    await teamsChatMappingRepository.createOrUpdateMapping({
      conversationId,
      teamsChatId: existingByParticipants.teamsChatId,
      participantEntraUserIds: [entraId1, entraId2],
      participantAccountIds,
    });
    return existingByParticipants.teamsChatId;
  }

  try {
    const teamsChat = await graphClient.getOrCreateOneOnOneChat(entraId1, entraId2);
    if (!teamsChat?.id) return null;

    await teamsChatMappingRepository.createOrUpdateMapping({
      conversationId,
      teamsChatId: teamsChat.id,
      participantEntraUserIds: [entraId1, entraId2],
      participantAccountIds,
    });
    return teamsChat.id;
  } catch (error) {
    logger.warn('teams_chat_creation_failed', { conversationId, entraId1, entraId2, error: error.message });
    return null;
  }
}

async function dispatchMessageToTeams({ conversation, message }) {
  if (!config.teams.enabled) {
    return { status: 'DISABLED' };
  }

  if (conversation.type !== 'DIRECT') {
    return { status: 'SKIPPED_NOT_DIRECT' };
  }

  if (!message.body || !message.body.trim()) {
    return { status: 'SKIPPED_EMPTY_BODY' };
  }

  const existingMapping = await teamsMessageMappingRepository.findByLngMessageId(message.id);
  if (existingMapping) {
    if (existingMapping.direction === TEAMS_SYNC_DIRECTIONS.INBOUND) {
      logger.debug('preventing_echo_loop_for_inbound_message', { lngMessageId: message.id });
      return { status: 'SKIPPED_ECHO_PREVENTION' };
    }
    return { status: 'SKIPPED_ALREADY_MAPPED' };
  }

  const participantAccountIds = conversation.participantAccountIds || [];
  const teamsChatId = await resolveTeamsChat({
    conversationId: conversation.id,
    participantAccountIds,
  });

  if (!teamsChatId) {
    return { status: 'SKIPPED_NO_TEAMS_CHAT' };
  }

  let userToken = null;
  const senderMapping = await teamsUserMappingRepository.findByAccountId(message.senderAccountId);
  if (senderMapping?.entraUserId) {
    const record = await teamsUserMappingRepository.getWithRefreshToken(senderMapping.entraUserId);
    if (record?.encryptedRefreshToken) {
      const rawRefreshToken = cryptoService.decrypt(record.encryptedRefreshToken);
      if (rawRefreshToken) {
        try {
          const tokenRes = await graphClient.refreshUserToken(rawRefreshToken);
          userToken = tokenRes.access_token;
          if (tokenRes.refresh_token && tokenRes.refresh_token !== rawRefreshToken) {
            await teamsUserMappingRepository.updateRefreshToken(
              senderMapping.entraUserId,
              cryptoService.encrypt(tokenRes.refresh_token),
            );
          }
        } catch (err) {
          logger.warn('teams_user_token_refresh_failed', { entraUserId: senderMapping.entraUserId, error: err.message });
        }
      }
    }
  }

  try {
    const teamsMessage = await graphClient.sendChatMessage(
      teamsChatId,
      { content: message.body, contentType: 'text' },
      { token: userToken },
    );

    const teamsMessageId = teamsMessage?.id;
    if (teamsMessageId) {
      await teamsMessageMappingRepository.createMapping({
        lngMessageId: message.id,
        teamsMessageId,
        teamsChatId,
        conversationId: conversation.id,
        direction: TEAMS_SYNC_DIRECTIONS.OUTBOUND,
        status: TEAMS_SYNC_STATUSES.SYNCED,
      });
      await teamsChatMappingRepository.updateLastSync(teamsChatId);
      return { status: 'SYNCED', teamsMessageId };
    }
    return { status: 'FAILED_NO_MESSAGE_ID' };
  } catch (error) {
    logger.warn('teams_send_chat_message_failed', {
      conversationId: conversation.id,
      lngMessageId: message.id,
      teamsChatId,
      error: error.message,
    });
    return { status: 'FAILED', error: error.message };
  }
}

async function processInboundWebhookNotification(notification = {}) {
  if (!config.teams.enabled) {
    return { status: 'DISABLED' };
  }

  if (config.teams.webhookClientState && notification.clientState !== config.teams.webhookClientState) {
    logger.warn('teams_webhook_client_state_mismatch', { received: notification.clientState });
    return { status: 'INVALID_CLIENT_STATE' };
  }

  if (notification.changeType && notification.changeType !== 'created') {
    return { status: 'IGNORED_CHANGE_TYPE' };
  }

  const { teamsChatId, teamsMessageId } = parseResource(notification.resource || notification.resourceData?.['@odata.id'] || '');
  const effectiveMessageId = teamsMessageId || notification.resourceData?.id;

  if (!teamsChatId || !effectiveMessageId) {
    logger.warn('teams_webhook_missing_resource_ids', { notification });
    return { status: 'INVALID_RESOURCE' };
  }

  const existingMapping = await teamsMessageMappingRepository.findByTeamsMessageId(effectiveMessageId);
  if (existingMapping) {
    logger.debug('teams_webhook_already_processed_or_echo', {
      teamsMessageId: effectiveMessageId,
      direction: existingMapping.direction,
    });
    return { status: 'SKIPPED_DUPLICATE_OR_ECHO' };
  }

  let messageDetails;
  try {
    messageDetails = await graphClient.getChatMessage(teamsChatId, effectiveMessageId);
  } catch (error) {
    logger.warn('teams_webhook_fetch_message_failed', {
      teamsChatId,
      teamsMessageId: effectiveMessageId,
      error: error.message,
    });
    return { status: 'FETCH_MESSAGE_FAILED', error: error.message };
  }

  if (!messageDetails || messageDetails.messageType !== 'message') {
    return { status: 'SKIPPED_NON_USER_MESSAGE' };
  }

  const rawBody = messageDetails.body?.content || '';
  const textBody = stripHtml(rawBody);
  if (!textBody) {
    return { status: 'SKIPPED_EMPTY_CONTENT' };
  }

  const senderEntraUser = messageDetails.from?.user;
  if (!senderEntraUser?.id) {
    return { status: 'SKIPPED_NO_SENDER' };
  }

  let chatDetails;
  try {
    chatDetails = await graphClient.getChat(teamsChatId);
  } catch (error) {
    logger.warn('teams_webhook_fetch_chat_failed', { teamsChatId, error: error.message });
    return { status: 'FETCH_CHAT_FAILED', error: error.message };
  }

  const members = chatDetails?.members || [];
  let otherMember = members.find((m) => m.userId && m.userId !== senderEntraUser.id);
  if (!otherMember && members.length === 2) {
    otherMember = members.find((m) => m.id !== senderEntraUser.id);
  }

  const isSenderGuest = senderEntraUser.userIdentityType === 'guest' || senderEntraUser.userIdentityType === 'externalUser';
  const senderAccountId = await resolveAccountForEntraUser({
    entraUserId: senderEntraUser.id,
    email: senderEntraUser.email || senderEntraUser.userPrincipalName || `teams_${senderEntraUser.id}@guest.lngwork.co`,
    displayName: senderEntraUser.displayName || 'External Guest',
    tenantId: senderEntraUser.tenantId || null,
    userType: isSenderGuest ? TEAMS_USER_TYPES.GUEST : TEAMS_USER_TYPES.INTERNAL,
  });

  const isOtherGuest = otherMember?.userIdentityType === 'guest' || otherMember?.userIdentityType === 'externalUser';
  const recipientAccountId = otherMember
    ? await resolveAccountForEntraUser({
      entraUserId: otherMember.userId || otherMember.id,
      email: otherMember.email || otherMember.userPrincipalName || `teams_${otherMember.userId || otherMember.id}@guest.lngwork.co`,
      displayName: otherMember.displayName || 'External Guest',
      tenantId: otherMember.tenantId || null,
      userType: isOtherGuest ? TEAMS_USER_TYPES.GUEST : TEAMS_USER_TYPES.INTERNAL,
    })
    : null;

  if (!senderAccountId || !recipientAccountId) {
    logger.warn('teams_inbound_cannot_resolve_accounts', {
      teamsChatId,
      senderEntraId: senderEntraUser.id,
      senderAccountId,
      recipientAccountId,
    });
    return { status: 'UNRESOLVED_ACCOUNTS' };
  }

  let conversation = null;
  const chatMapping = await teamsChatMappingRepository.findByTeamsChatId(teamsChatId);
  if (chatMapping?.conversationId) {
    conversation = await chatPublic.getConversationById(chatMapping.conversationId);
  }

  if (!conversation) {
    conversation = await chatPublic.findDirectConversation([senderAccountId, recipientAccountId]);
    if (!conversation) {
      const isExternalChat = isSenderGuest || isOtherGuest;
      const title = isExternalChat
        ? (isSenderGuest ? senderEntraUser.displayName : otherMember?.displayName)
        : null;

      conversation = await chatPublic.createConversation(
        {
          type: 'DIRECT',
          title: title || null,
          participantAccountIds: [senderAccountId, recipientAccountId],
        },
        { accountId: senderAccountId },
      );
    }

    await teamsChatMappingRepository.createOrUpdateMapping({
      conversationId: conversation.id,
      teamsChatId,
      participantEntraUserIds: [senderEntraUser.id, otherMember?.userId || otherMember?.id].filter(Boolean),
      participantAccountIds: [senderAccountId, recipientAccountId],
      isExternal: isSenderGuest || isOtherGuest,
      externalParticipantDetails: (isSenderGuest || isOtherGuest)
        ? {
          sender: senderEntraUser,
          otherMember,
        }
        : null,
    });
  }

  const createdMessage = await chatPublic.sendMessage(
    conversation.id,
    {
      body: textBody,
      assetIds: [],
      mentions: [],
      ...(messageDetails.createdDateTime ? { createdAt: new Date(messageDetails.createdDateTime) } : {}),
    },
    { accountId: senderAccountId },
    { source: 'TEAMS_INBOUND' },
  );

  await teamsMessageMappingRepository.createMapping({
    lngMessageId: createdMessage.id,
    teamsMessageId: effectiveMessageId,
    teamsChatId,
    conversationId: conversation.id,
    direction: TEAMS_SYNC_DIRECTIONS.INBOUND,
    status: TEAMS_SYNC_STATUSES.SYNCED,
  });

  await notificationPublic.notify({
    recipientAccountId,
    type: TEAMS_NOTIFICATION_TYPES.CHAT_MESSAGE,
    title: senderEntraUser.displayName || 'Tin nhắn mới từ Teams',
    message: textBody.length > 100 ? `${textBody.slice(0, 97)}...` : textBody,
    relatedResource: { type: 'chatConversation', id: String(conversation.id) },
    deduplicationKey: `TEAMS_MSG:${effectiveMessageId}:${recipientAccountId}`,
  });

  await teamsChatMappingRepository.updateLastSync(teamsChatId);

  return {
    status: 'PROCESSED',
    conversationId: conversation.id,
    lngMessageId: createdMessage.id,
    teamsMessageId: effectiveMessageId,
  };
}

async function ensureWebhookSubscription() {
  if (!config.teams.enabled || !config.teams.webhookUrl) {
    return { status: 'DISABLED_OR_NO_URL' };
  }

  const active = await teamsSubscriptionRepository.findActiveSubscription();
  if (active) {
    const msUntilExpiry = new Date(active.expirationDateTime).getTime() - Date.now();
    if (msUntilExpiry > 15 * 60 * 1000) {
      return { status: 'ACTIVE', subscription: active };
    }

    try {
      const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();
      const res = await graphClient.renewSubscription(active.subscriptionId, { expirationDateTime });
      const saved = await teamsSubscriptionRepository.saveSubscription({
        ...active,
        expirationDateTime: new Date(res?.expirationDateTime || expirationDateTime),
        status: 'ACTIVE',
      });
      return { status: 'RENEWED', subscription: saved };
    } catch (_err) {
      await teamsSubscriptionRepository.updateStatus(active.subscriptionId, 'EXPIRED');
    }
  }

  const resource = '/chats/getAllMessages';
  const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();
  const clientState = config.teams.webhookClientState || 'lng-teams-sync-secret';

  try {
    const res = await graphClient.createSubscription({
      resource,
      notificationUrl: config.teams.webhookUrl,
      clientState,
      expirationDateTime,
    });

    const saved = await teamsSubscriptionRepository.saveSubscription({
      subscriptionId: res.id,
      resource,
      clientState,
      notificationUrl: config.teams.webhookUrl,
      expirationDateTime: new Date(res.expirationDateTime || expirationDateTime),
      status: 'ACTIVE',
    });

    return { status: 'CREATED', subscription: saved };
  } catch (error) {
    logger.warn('teams_create_subscription_failed', { error: error.message });
    return { status: 'FAILED', error: error.message };
  }
}

module.exports = {
  stripHtml,
  parseResource,
  linkUserWithEntra,
  resolveUserEntraId,
  resolveAccountForEntraUser,
  resolveTeamsChat,
  dispatchMessageToTeams,
  processInboundWebhookNotification,
  ensureWebhookSubscription,
};
