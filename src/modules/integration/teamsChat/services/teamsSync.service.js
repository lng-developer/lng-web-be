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
    const canonical = await authPublic.findAccountByMicrosoftId(entraUserId);
    if (canonical?.id) {
      if (String(existing?.accountId || '') !== String(canonical.id)) {
        await teamsUserMappingRepository.upsertMapping({
          entraUserId, accountId: canonical.id, email: canonical.email,
        });
      }
      return canonical.id;
    }
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

async function resolveTeamsChat({ conversationId, participantAccountIds = [], type = 'DIRECT', title = null, userToken = null }) {
  const existingMapping = await teamsChatMappingRepository.findByConversationId(conversationId);
  if (existingMapping?.teamsChatId) return existingMapping.teamsChatId;

  const entraIdPairs = await Promise.all(
    participantAccountIds.map(async (accId) => ({
      accountId: accId,
      entraId: await resolveUserEntraId(accId),
    }))
  );

  const entraUserIds = entraIdPairs.map((p) => p.entraId).filter(Boolean);

  if (entraUserIds.length < 2) {
    logger.debug('cannot_resolve_teams_chat_insufficient_entra_ids', {
      conversationId,
      totalParticipants: participantAccountIds.length,
      resolvedEntraCount: entraUserIds.length,
    });
    return null;
  }

  if (type === 'DIRECT' && participantAccountIds.length === 2 && entraUserIds.length === 2) {
    const [entraId1, entraId2] = entraUserIds;
    const existingByParticipants = await teamsChatMappingRepository.findByParticipantEntraUserIds(entraId1, entraId2);
    if (existingByParticipants?.teamsChatId) {
      await teamsChatMappingRepository.createOrUpdateMapping({
        conversationId,
        teamsChatId: existingByParticipants.teamsChatId,
        chatType: 'oneOnOne',
        participantEntraUserIds: [entraId1, entraId2],
        participantAccountIds,
      });
      return existingByParticipants.teamsChatId;
    }

    // Check if deterministic one-on-one Teams chat exists in Teams
    const candidateChatIds = [
      `19:${entraId1}_${entraId2}@unq.gbl.spaces`,
      `19:${entraId2}_${entraId1}@unq.gbl.spaces`,
    ];
    for (const candidateId of candidateChatIds) {
      try {
        const found = await graphClient.getChat(candidateId, { token: userToken });
        if (found?.id) {
          await teamsChatMappingRepository.createOrUpdateMapping({
            conversationId,
            teamsChatId: found.id,
            chatType: 'oneOnOne',
            participantEntraUserIds: [entraId1, entraId2],
            participantAccountIds,
          });
          return found.id;
        }
      } catch (_err) {
        // Not found under this ID order, try next
      }
    }

    try {
      const teamsChat = await graphClient.getOrCreateOneOnOneChat(entraId1, entraId2, { token: userToken });
      if (!teamsChat?.id) return null;

      await teamsChatMappingRepository.createOrUpdateMapping({
        conversationId,
        teamsChatId: teamsChat.id,
        chatType: 'oneOnOne',
        participantEntraUserIds: [entraId1, entraId2],
        participantAccountIds,
      });
      return teamsChat.id;
    } catch (error) {
      logger.warn('teams_chat_creation_failed', { conversationId, entraId1, entraId2, error: error.message });
      return null;
    }
  }

  // Group chat (TEAM or > 2 participants)
  try {
    const teamsChat = await graphClient.createGroupChat(entraUserIds, title || 'Portal Group', { token: userToken });
    if (!teamsChat?.id) return null;

    await teamsChatMappingRepository.createOrUpdateMapping({
      conversationId,
      teamsChatId: teamsChat.id,
      chatType: 'group',
      participantEntraUserIds: entraUserIds,
      participantAccountIds,
    });
    return teamsChat.id;
  } catch (error) {
    logger.warn('teams_group_chat_creation_failed', { conversationId, entraUserIds, error: error.message });
    return null;
  }
}

const userTokenCache = new Map();

async function catchUpUnmappedMessages({ conversation, userToken, currentMessageId, senderAccountId }) {
  if (!userToken || conversation.type !== 'DIRECT') return { syncedCount: 0 };
  let syncedCount = 0;
  try {
    const listRes = await chatPublic.listMessages(conversation.id, { page: 1, limit: 100 }, { isSystem: true });
    const items = listRes?.items || [];
    for (const item of items) {
      if (String(item.id) === String(currentMessageId)) continue;
      if (!item.body || !item.body.trim()) continue;
      if (senderAccountId && String(item.senderAccountId) !== String(senderAccountId)) continue;
      const existing = await teamsMessageMappingRepository.findByLngMessageId(item.id);
      if (!existing) {
        await dispatchMessageToTeams({
          conversation,
          message: item,
          explicitUserToken: userToken,
          isCatchUp: true,
        });
        syncedCount += 1;
      }
    }
  } catch (err) {
    logger.warn('teams_catchup_sync_failed', { conversationId: conversation.id, error: err.message });
  }
  return { syncedCount };
}

async function dispatchMessageToTeams({ conversation, message, explicitUserToken = null, isCatchUp = false }) {
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

  let userToken = explicitUserToken || (message.senderAccountId ? userTokenCache.get(String(message.senderAccountId)) : null);
  if (explicitUserToken && message.senderAccountId) {
    userTokenCache.set(String(message.senderAccountId), explicitUserToken);
  }

  if (!userToken && message.senderAccountId) {
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
  }

  const participantAccountIds = conversation.participantAccountIds || [];
  const teamsChatId = await resolveTeamsChat({
    conversationId: conversation.id,
    participantAccountIds,
    type: conversation.type,
    title: conversation.title,
    userToken,
  });

  if (!teamsChatId) {
    return { status: 'SKIPPED_NO_TEAMS_CHAT' };
  }

  if (!isCatchUp && userToken) {
    await catchUpUnmappedMessages({
      conversation,
      userToken,
      currentMessageId: message.id,
      senderAccountId: message.senderAccountId,
    });
  }

  try {
    const teamsMessage = await graphClient.sendChatMessage(
      teamsChatId,
      { content: message.body, contentType: 'text' },
      { token: userToken || null },
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
  const isGroup = chatDetails?.chatType === 'group' || members.length > 2;

  const isSenderGuest = senderEntraUser.userIdentityType === 'guest' || senderEntraUser.userIdentityType === 'externalUser';
  const senderAccountId = await resolveAccountForEntraUser({
    entraUserId: senderEntraUser.id,
    email: senderEntraUser.email || senderEntraUser.userPrincipalName || `teams_${senderEntraUser.id}@guest.lngwork.co`,
    displayName: senderEntraUser.displayName || 'External Guest',
    tenantId: senderEntraUser.tenantId || null,
    userType: isSenderGuest ? TEAMS_USER_TYPES.GUEST : TEAMS_USER_TYPES.INTERNAL,
  });

  let otherMember = null;
  let recipientAccountId = null;

  if (!isGroup) {
    otherMember = members.find((m) => m.userId && m.userId !== senderEntraUser.id);
    if (!otherMember && members.length === 2) {
      otherMember = members.find((m) => m.id !== senderEntraUser.id);
    }

    const isOtherGuest = otherMember?.userIdentityType === 'guest' || otherMember?.userIdentityType === 'externalUser';
    recipientAccountId = otherMember
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
  } else if (!senderAccountId) {
    logger.warn('teams_inbound_cannot_resolve_sender', {
      teamsChatId,
      senderEntraId: senderEntraUser.id,
    });
    return { status: 'UNRESOLVED_ACCOUNTS' };
  }

  let conversation = null;
  const chatMapping = await teamsChatMappingRepository.findByTeamsChatId(teamsChatId);
  if (chatMapping?.conversationId) {
    conversation = await chatPublic.getConversationById(chatMapping.conversationId);
  }

  if (!conversation) {
    if (isGroup) {
      const participantAccountIds = [senderAccountId];
      const participantEntraUserIds = [senderEntraUser.id];

      for (const member of members) {
        const entraId = member.userId || member.id;
        if (!entraId || entraId === senderEntraUser.id) continue;
        participantEntraUserIds.push(entraId);

        const isMemberGuest = member.userIdentityType === 'guest' || member.userIdentityType === 'externalUser';
        const memberAccountId = await resolveAccountForEntraUser({
          entraUserId: entraId,
          email: member.email || member.userPrincipalName || `teams_${entraId}@guest.lngwork.co`,
          displayName: member.displayName || 'Teams Member',
          tenantId: member.tenantId || null,
          userType: isMemberGuest ? TEAMS_USER_TYPES.GUEST : TEAMS_USER_TYPES.INTERNAL,
        });
        if (memberAccountId && !participantAccountIds.includes(memberAccountId)) {
          participantAccountIds.push(memberAccountId);
        }
      }

      conversation = await chatPublic.createConversation(
        {
          type: 'TEAM',
          title: chatDetails.topic || 'Teams Group',
          participantAccountIds,
        },
        { accountId: senderAccountId },
      );

      await teamsChatMappingRepository.createOrUpdateMapping({
        conversationId: conversation.id,
        teamsChatId,
        chatType: 'group',
        participantEntraUserIds,
        participantAccountIds,
      });
    } else {
      conversation = await chatPublic.findDirectConversation([senderAccountId, recipientAccountId]);
      if (!conversation) {
        const isExternalChat = isSenderGuest || (otherMember?.userIdentityType === 'guest' || otherMember?.userIdentityType === 'externalUser');
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

      const isOtherGuest = otherMember?.userIdentityType === 'guest' || otherMember?.userIdentityType === 'externalUser';
      await teamsChatMappingRepository.createOrUpdateMapping({
        conversationId: conversation.id,
        teamsChatId,
        chatType: 'oneOnOne',
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

  const recipientIds = (conversation.participantAccountIds || []).filter(
    (id) => String(id) !== String(senderAccountId),
  );

  const notifTitle = conversation.type === 'DIRECT'
    ? (senderEntraUser.displayName || 'Tin nhắn mới từ Teams')
    : (conversation.title || chatDetails?.topic || `${senderEntraUser.displayName || 'Thành viên'} trong nhóm Teams`);

  await Promise.all(recipientIds.map((recipientAccountId) =>
    notificationPublic.notify({
      recipientAccountId,
      type: TEAMS_NOTIFICATION_TYPES.CHAT_MESSAGE,
      title: notifTitle,
      message: textBody.length > 100 ? `${textBody.slice(0, 97)}...` : textBody,
      relatedResource: { type: 'chatConversation', id: String(conversation.id) },
      deduplicationKey: `TEAMS_MSG:${effectiveMessageId}:${recipientAccountId}`,
    })
  ));

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

  let active = await teamsSubscriptionRepository.findActiveSubscription();
  const clientState = config.teams.webhookClientState || 'lng-teams-sync-secret';
  if (active && (active.notificationUrl !== config.teams.webhookUrl || active.clientState !== clientState)) {
    try {
      await graphClient.deleteSubscription(active.subscriptionId);
    } catch (error) {
      if (error.status !== 404) {
        return { status: 'FAILED', error: 'Could not replace outdated Teams subscription' };
      }
    }
    await teamsSubscriptionRepository.updateStatus(active.subscriptionId, 'REVOKED');
    active = null;
  }
  if (active) {
    if (active.notificationUrl && active.notificationUrl !== config.teams.webhookUrl) {
      try {
        await graphClient.deleteSubscription(active.subscriptionId);
      } catch (_err) {
        // ignore if already deleted on Graph
      }
      await teamsSubscriptionRepository.updateStatus(active.subscriptionId, 'SUPERSEDED');
    } else {
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
  }

  const resource = '/chats/getAllMessages';
  const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();

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

async function syncInboundMessagesForConversation({ conversationId, limit = 30 }) {
  if (!config.teams.enabled) {
    return { status: 'DISABLED', syncedCount: 0 };
  }

  const conversation = await chatPublic.getConversationById(conversationId);
  if (!conversation) {
    return { status: 'CONVERSATION_NOT_FOUND', syncedCount: 0 };
  }

  const participantAccountIds = (conversation.participantAccountIds || []).map((id) => String(id));
  const teamsChatId = await resolveTeamsChat({
    conversationId: conversation.id,
    participantAccountIds,
    type: conversation.type,
    title: conversation.title,
  });

  if (!teamsChatId) {
    return { status: 'SKIPPED_NO_TEAMS_CHAT', syncedCount: 0 };
  }

  let rawMessages = [];
  try {
    const listRes = await graphClient.listChatMessages(teamsChatId, { top: limit });
    rawMessages = (listRes?.value || []).slice().reverse();
  } catch (err) {
    logger.warn('teams_sync_list_messages_failed', { conversationId, teamsChatId, error: err.message });
    return { status: 'FAILED_FETCH', error: err.message, syncedCount: 0 };
  }

  let syncedCount = 0;
  for (const msg of rawMessages) {
    if (msg.messageType !== 'message') continue;
    const textBody = stripHtml(msg.body?.content);
    if (!textBody) continue;

    const existing = await teamsMessageMappingRepository.findByTeamsChatAndMessageId(teamsChatId, msg.id);
    if (existing) continue;

    const senderEntraUser = msg.from?.user;
    let senderAccountId = null;
    if (senderEntraUser?.id) {
      senderAccountId = await resolveAccountForEntraUser({
        entraUserId: senderEntraUser.id,
        email: senderEntraUser.userPrincipalName || senderEntraUser.email || '',
        displayName: senderEntraUser.displayName || null,
      });
    }

    if (!senderAccountId) {
      senderAccountId = participantAccountIds[0];
    }

    try {
      const createdMessage = await chatPublic.sendMessage(
        conversation.id,
        {
          body: textBody,
          assetIds: [],
          mentions: [],
          createdAt: msg.createdDateTime ? new Date(msg.createdDateTime) : undefined,
        },
        { accountId: senderAccountId },
        { source: 'TEAMS_INBOUND' },
      );

      await teamsMessageMappingRepository.createMapping({
        lngMessageId: createdMessage.id,
        teamsMessageId: msg.id,
        teamsChatId,
        conversationId: conversation.id,
        direction: TEAMS_SYNC_DIRECTIONS.INBOUND,
        status: TEAMS_SYNC_STATUSES.SYNCED,
      });

      syncedCount++;
    } catch (sendErr) {
      logger.warn('teams_sync_inbound_save_failed', {
        conversationId: conversation.id,
        teamsMessageId: msg.id,
        error: sendErr.message,
      });
    }
  }

  await teamsChatMappingRepository.updateLastSync(teamsChatId);
  return { status: 'SYNCED', syncedCount, teamsChatId };
}

module.exports = {
  stripHtml,
  parseResource,
  linkUserWithEntra,
  resolveUserEntraId,
  resolveAccountForEntraUser,
  resolveTeamsChat,
  dispatchMessageToTeams,
  catchUpUnmappedMessages,
  processInboundWebhookNotification,
  ensureWebhookSubscription,
  syncInboundMessagesForConversation,
};
