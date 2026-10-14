jest.mock('../../../src/config', () => ({
  log: {
    level: 'silent',
  },
  teams: {
    enabled: true,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tenantId: 'test-tenant-id',
    webhookUrl: 'https://portal.lngwork.co/api/integration/teams/webhook',
    webhookClientState: 'test-client-state-secret',
    encryptionKey: 'test-32-byte-encryption-key-teams',
  },
  auth: {
    jwtAccessSecret: 'test-jwt-access-secret',
  },
}));

jest.mock('../../../src/modules/auth/public', () => ({
  getCurrentAccount: jest.fn(),
  findAccountByMicrosoftId: jest.fn(),
  findAccountByEmail: jest.fn(),
  ensureTeamsAccount: jest.fn(),
}));

jest.mock('../../../src/modules/chat/public', () => ({
  createConversation: jest.fn(),
  findDirectConversation: jest.fn(),
  getConversationById: jest.fn(),
  getConversationMessages: jest.fn(),
  listMessages: jest.fn(),
  sendMessage: jest.fn(),
  chatEvents: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

jest.mock('../../../src/modules/notification/public', () => ({
  notify: jest.fn(),
}));

jest.mock('../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository', () => ({
  findByAccountId: jest.fn(),
  findByEntraUserId: jest.fn(),
  findByEmail: jest.fn(),
  upsertMapping: jest.fn(),
  getWithRefreshToken: jest.fn(),
  updateRefreshToken: jest.fn(),
}));

jest.mock('../../../src/modules/integration/teamsChat/repositories/teamsChatMapping.repository', () => ({
  findByConversationId: jest.fn(),
  findByTeamsChatId: jest.fn(),
  findByParticipantEntraUserIds: jest.fn(),
  createOrUpdateMapping: jest.fn(),
  updateLastSync: jest.fn(),
}));

jest.mock('../../../src/modules/integration/teamsChat/repositories/teamsMessageMapping.repository', () => ({
  findByLngMessageId: jest.fn(),
  findByTeamsMessageId: jest.fn(),
  findByTeamsChatAndMessageId: jest.fn(),
  createMapping: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../src/modules/integration/teamsChat/repositories/teamsSubscription.repository', () => ({
  findActiveSubscription: jest.fn(),
  saveSubscription: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../src/modules/integration/teamsChat/services/microsoftGraphClient', () => ({
  getAppToken: jest.fn(),
  refreshUserToken: jest.fn(),
  getOrCreateOneOnOneChat: jest.fn(),
  sendChatMessage: jest.fn(),
  getChatMessage: jest.fn(),
  listChatMessages: jest.fn(),
  getChat: jest.fn(),
  createSubscription: jest.fn(),
  renewSubscription: jest.fn(),
  deleteSubscription: jest.fn(),
}));

const config = require('../../../src/config');
const authPublic = require('../../../src/modules/auth/public');
const chatPublic = require('../../../src/modules/chat/public');
const notificationPublic = require('../../../src/modules/notification/public');
const teamsUserMappingRepository = require('../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository');
const teamsChatMappingRepository = require('../../../src/modules/integration/teamsChat/repositories/teamsChatMapping.repository');
const teamsMessageMappingRepository = require('../../../src/modules/integration/teamsChat/repositories/teamsMessageMapping.repository');
const teamsSubscriptionRepository = require('../../../src/modules/integration/teamsChat/repositories/teamsSubscription.repository');
const graphClient = require('../../../src/modules/integration/teamsChat/services/microsoftGraphClient');
const teamsSyncService = require('../../../src/modules/integration/teamsChat/services/teamsSync.service');
const { TEAMS_SYNC_DIRECTIONS, TEAMS_SYNC_STATUSES } = require('../../../src/modules/integration/teamsChat/constants/teams.constants');

describe('Teams chat synchronization service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.teams.enabled = true;
  });

  test('repairs a stale Teams mapping from the canonical Microsoft account', async () => {
    authPublic.findAccountByMicrosoftId.mockResolvedValueOnce({ id: 'current-account', email: 'user@example.com' });
    teamsUserMappingRepository.findByEntraUserId.mockResolvedValueOnce({ accountId: 'deleted-account' });
    const result = await teamsSyncService.resolveAccountForEntraUser({ entraUserId: 'entra-user' });
    expect(result).toBe('current-account');
    expect(teamsUserMappingRepository.upsertMapping).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'current-account', entraUserId: 'entra-user', email: 'user@example.com',
    }));
  });

  test.each(['notificationUrl', 'clientState'])('replaces a subscription with changed %s', async (field) => {
    const repository = require('../../../src/modules/integration/teamsChat/repositories/teamsSubscription.repository');
    repository.findActiveSubscription.mockResolvedValueOnce({
      subscriptionId: 'old-sub', notificationUrl: config.teams.webhookUrl,
      clientState: config.teams.webhookClientState,
      expirationDateTime: new Date(Date.now() + 3600000), [field]: 'outdated',
    });
    graphClient.createSubscription.mockResolvedValueOnce({ id: 'new-sub' });
    await teamsSyncService.ensureWebhookSubscription();
    expect(graphClient.deleteSubscription).toHaveBeenCalledWith('old-sub');
    expect(repository.updateStatus).toHaveBeenCalledWith('old-sub', 'REVOKED');
    expect(graphClient.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      notificationUrl: config.teams.webhookUrl, clientState: config.teams.webhookClientState,
    }));
  });

  describe('Outbound dispatch (Portal -> Teams)', () => {
    test('skips dispatch when feature flag is disabled', async () => {
      config.teams.enabled = false;
      const result = await teamsSyncService.dispatchMessageToTeams({
        conversation: { type: 'DIRECT', participantAccountIds: ['acc-1', 'acc-2'] },
        message: { id: 'msg-1', body: 'Hello' },
      });

      expect(result).toEqual({ status: 'DISABLED' });
      expect(graphClient.sendChatMessage).not.toHaveBeenCalled();
    });

    test('skips dispatch when conversation is not DIRECT', async () => {
      const result = await teamsSyncService.dispatchMessageToTeams({
        conversation: { type: 'TEAM', participantAccountIds: ['acc-1', 'acc-2'] },
        message: { id: 'msg-1', body: 'Hello' },
      });

      expect(result).toEqual({ status: 'SKIPPED_NOT_DIRECT' });
      expect(graphClient.sendChatMessage).not.toHaveBeenCalled();
    });

    test('skips dispatch when no teams chat could be resolved', async () => {
      teamsMessageMappingRepository.findByLngMessageId.mockResolvedValue(null);
      teamsChatMappingRepository.findByConversationId.mockResolvedValue(null);
      teamsUserMappingRepository.findByAccountId.mockResolvedValue(null);

      const result = await teamsSyncService.dispatchMessageToTeams({
        conversation: { type: 'DIRECT', participantAccountIds: ['acc-1', 'acc-2'] },
        message: { id: 'msg-1', body: 'Hello' },
      });

      expect(result).toEqual({ status: 'SKIPPED_NO_TEAMS_CHAT' });
      expect(graphClient.sendChatMessage).not.toHaveBeenCalled();
    });

    test('catchUpUnmappedMessages only syncs messages belonging to the authenticated sender and ignores other senders', async () => {
      chatPublic.listMessages.mockResolvedValue({
        items: [
          { id: 'msg-other-user', senderAccountId: 'acc-admin', body: 'hay vay' },
          { id: 'msg-my-user', senderAccountId: 'acc-luan', body: 'sdfgs' },
        ],
      });
      teamsMessageMappingRepository.findByLngMessageId.mockResolvedValue(null);
      teamsChatMappingRepository.findByConversationId.mockResolvedValue({
        teamsChatId: '19:direct-chat@unq.gbl.spaces',
      });
      graphClient.sendChatMessage.mockResolvedValue({ id: 'teams-msg-luan' });

      const syncResult = await teamsSyncService.catchUpUnmappedMessages({
        conversation: { id: 'conv-direct-1', type: 'DIRECT', participantAccountIds: ['acc-luan', 'acc-bob'] },
        senderAccountId: 'acc-luan',
        userToken: 'luan-delegated-token',
      });

      expect(syncResult.syncedCount).toBe(1);
      // Ensure sendChatMessage was called with luan-delegated-token ONLY for luan's message
      expect(graphClient.sendChatMessage).toHaveBeenCalledTimes(1);
      expect(graphClient.sendChatMessage).toHaveBeenCalledWith(
        '19:direct-chat@unq.gbl.spaces',
        { content: 'sdfgs', contentType: 'text' },
        { token: 'luan-delegated-token' },
      );
      // msg-other-user was NEVER dispatched using luan's token
      expect(teamsMessageMappingRepository.createMapping).toHaveBeenCalledWith(
        expect.objectContaining({ lngMessageId: 'msg-my-user' }),
      );
    });

    test('prevents echo loop when message was originated from Teams (INBOUND)', async () => {
      teamsMessageMappingRepository.findByLngMessageId.mockResolvedValue({
        lngMessageId: 'msg-inbound-1',
        teamsMessageId: 'teams-msg-1',
        direction: TEAMS_SYNC_DIRECTIONS.INBOUND,
      });

      const result = await teamsSyncService.dispatchMessageToTeams({
        conversation: { id: 'conv-1', type: 'DIRECT', participantAccountIds: ['acc-1', 'acc-2'] },
        message: { id: 'msg-inbound-1', body: 'Hello from Teams' },
      });

      expect(result).toEqual({ status: 'SKIPPED_ECHO_PREVENTION' });
      expect(graphClient.sendChatMessage).not.toHaveBeenCalled();
    });

    test('successfully dispatches text message to Teams and records mapping', async () => {
      teamsMessageMappingRepository.findByLngMessageId.mockResolvedValue(null);
      teamsChatMappingRepository.findByConversationId.mockResolvedValue({
        teamsChatId: '19:sample-chat@unq.gbl.spaces',
      });
      teamsUserMappingRepository.findByAccountId.mockResolvedValue({
        entraUserId: 'entra-user-1',
      });
      teamsUserMappingRepository.getWithRefreshToken.mockResolvedValue(null);

      graphClient.sendChatMessage.mockResolvedValue({
        id: 'teams-created-msg-999',
      });

      const result = await teamsSyncService.dispatchMessageToTeams({
        conversation: { id: 'conv-1', type: 'DIRECT', participantAccountIds: ['acc-1', 'acc-2'] },
        message: { id: 'msg-portal-1', senderAccountId: 'acc-1', body: 'Hello Teams!' },
      });

      expect(result).toEqual({ status: 'SYNCED', teamsMessageId: 'teams-created-msg-999' });
      expect(graphClient.sendChatMessage).toHaveBeenCalledWith(
        '19:sample-chat@unq.gbl.spaces',
        { content: 'Hello Teams!', contentType: 'text' },
        { token: null },
      );
      expect(teamsMessageMappingRepository.createMapping).toHaveBeenCalledWith({
        lngMessageId: 'msg-portal-1',
        teamsMessageId: 'teams-created-msg-999',
        teamsChatId: '19:sample-chat@unq.gbl.spaces',
        conversationId: 'conv-1',
        direction: TEAMS_SYNC_DIRECTIONS.OUTBOUND,
        status: TEAMS_SYNC_STATUSES.SYNCED,
      });
      expect(teamsChatMappingRepository.updateLastSync).toHaveBeenCalledWith('19:sample-chat@unq.gbl.spaces');
    });

    test('gracefully handles Graph API failure without throwing error', async () => {
      teamsMessageMappingRepository.findByLngMessageId.mockResolvedValue(null);
      teamsChatMappingRepository.findByConversationId.mockResolvedValue({
        teamsChatId: '19:sample-chat@unq.gbl.spaces',
      });
      teamsUserMappingRepository.findByAccountId.mockResolvedValue(null);
      graphClient.sendChatMessage.mockRejectedValue(new Error('Network timeout'));

      const result = await teamsSyncService.dispatchMessageToTeams({
        conversation: { id: 'conv-1', type: 'DIRECT', participantAccountIds: ['acc-1', 'acc-2'] },
        message: { id: 'msg-portal-1', senderAccountId: 'acc-1', body: 'Hello Teams!' },
      });

      expect(result).toEqual({ status: 'FAILED', error: 'Network timeout' });
    });
  });

  describe('Inbound webhook processing (Teams -> Portal)', () => {
    test('rejects webhook notification with invalid clientState', async () => {
      const result = await teamsSyncService.processInboundWebhookNotification({
        clientState: 'wrong-secret',
        resource: "chats('19:chat@unq.gbl.spaces')/messages('1690001')",
      });

      expect(result).toEqual({ status: 'INVALID_CLIENT_STATE' });
    });

    test('prevents echo loop when message already exists in message mapping', async () => {
      teamsMessageMappingRepository.findByTeamsMessageId.mockResolvedValue({
        teamsMessageId: '1690001',
        direction: TEAMS_SYNC_DIRECTIONS.OUTBOUND,
      });

      const result = await teamsSyncService.processInboundWebhookNotification({
        clientState: 'test-client-state-secret',
        changeType: 'created',
        resource: "chats('19:chat@unq.gbl.spaces')/messages('1690001')",
      });

      expect(result).toEqual({ status: 'SKIPPED_DUPLICATE_OR_ECHO' });
      expect(chatPublic.sendMessage).not.toHaveBeenCalled();
    });

    test('processes new inbound Teams message, creates Portal message and notification', async () => {
      teamsMessageMappingRepository.findByTeamsMessageId.mockResolvedValue(null);

      graphClient.getChatMessage.mockResolvedValue({
        id: '1690002',
        messageType: 'message',
        body: {
          contentType: 'html',
          content: '<p>Hello from Teams client!</p>',
        },
        from: {
          user: {
            id: 'entra-sender-id',
            displayName: 'Alice Teams',
            email: 'alice@lngwork.co',
            userIdentityType: 'aadUser',
          },
        },
      });

      graphClient.getChat.mockResolvedValue({
        id: '19:chat-123@unq.gbl.spaces',
        members: [
          { userId: 'entra-sender-id', displayName: 'Alice Teams', email: 'alice@lngwork.co' },
          { userId: 'entra-recipient-id', displayName: 'Bob Portal', email: 'bob@lngwork.co' },
        ],
      });

      teamsUserMappingRepository.findByEntraUserId
        .mockResolvedValueOnce({ accountId: 'acc-sender-alice' })
        .mockResolvedValueOnce({ accountId: 'acc-recipient-bob' });

      teamsChatMappingRepository.findByTeamsChatId.mockResolvedValue({
        conversationId: 'conv-direct-1',
      });

      chatPublic.getConversationById.mockResolvedValue({
        id: 'conv-direct-1',
        type: 'DIRECT',
        participantAccountIds: ['acc-sender-alice', 'acc-recipient-bob'],
      });

      chatPublic.sendMessage.mockResolvedValue({
        id: 'lng-msg-created-777',
        conversationId: 'conv-direct-1',
        body: 'Hello from Teams client!',
      });

      const result = await teamsSyncService.processInboundWebhookNotification({
        clientState: 'test-client-state-secret',
        changeType: 'created',
        resource: "chats('19:chat-123@unq.gbl.spaces')/messages('1690002')",
      });

      expect(result).toEqual({
        status: 'PROCESSED',
        conversationId: 'conv-direct-1',
        lngMessageId: 'lng-msg-created-777',
        teamsMessageId: '1690002',
      });

      expect(chatPublic.sendMessage).toHaveBeenCalledWith(
        'conv-direct-1',
        { body: 'Hello from Teams client!', assetIds: [], mentions: [] },
        { accountId: 'acc-sender-alice' },
        { source: 'TEAMS_INBOUND' },
      );

      expect(teamsMessageMappingRepository.createMapping).toHaveBeenCalledWith({
        lngMessageId: 'lng-msg-created-777',
        teamsMessageId: '1690002',
        teamsChatId: '19:chat-123@unq.gbl.spaces',
        conversationId: 'conv-direct-1',
        direction: TEAMS_SYNC_DIRECTIONS.INBOUND,
        status: TEAMS_SYNC_STATUSES.SYNCED,
      });

      expect(notificationPublic.notify).toHaveBeenCalledWith({
        recipientAccountId: 'acc-recipient-bob',
        type: 'CHAT_MESSAGE',
        title: 'Alice Teams',
        message: 'Hello from Teams client!',
        relatedResource: { type: 'chatConversation', id: 'conv-direct-1' },
        deduplicationKey: 'TEAMS_MSG:1690002:acc-recipient-bob',
      });
    });

    test('handles message from external customer/guest by ensuring guest account', async () => {
      teamsMessageMappingRepository.findByTeamsMessageId.mockResolvedValue(null);

      graphClient.getChatMessage.mockResolvedValue({
        id: '1690003',
        messageType: 'message',
        body: {
          contentType: 'text',
          content: 'Hello, I am an external guest client.',
        },
        from: {
          user: {
            id: 'external-entra-guest-id',
            displayName: 'Guest Partner',
            email: 'partner@external.com',
            userIdentityType: 'guest',
            tenantId: 'partner-tenant-id',
          },
        },
      });

      graphClient.getChat.mockResolvedValue({
        id: '19:external-chat@unq.gbl.spaces',
        members: [
          { userId: 'external-entra-guest-id', displayName: 'Guest Partner', email: 'partner@external.com', userIdentityType: 'guest' },
          { userId: 'internal-entra-id', displayName: 'Staff LNG', email: 'staff@lngwork.co' },
        ],
      });

      teamsUserMappingRepository.findByEntraUserId.mockResolvedValue(null);

      authPublic.ensureTeamsAccount
        .mockResolvedValueOnce({ id: 'acc-guest-partner', email: 'partner@external.com' })
        .mockResolvedValueOnce({ id: 'acc-staff-lng', email: 'staff@lngwork.co' });

      teamsChatMappingRepository.findByTeamsChatId.mockResolvedValue(null);
      chatPublic.findDirectConversation.mockResolvedValue(null);
      chatPublic.createConversation.mockResolvedValue({
        id: 'conv-external-direct-1',
        type: 'DIRECT',
        participantAccountIds: ['acc-guest-partner', 'acc-staff-lng'],
      });

      chatPublic.sendMessage.mockResolvedValue({
        id: 'lng-msg-guest-1',
        conversationId: 'conv-external-direct-1',
        body: 'Hello, I am an external guest client.',
      });

      const result = await teamsSyncService.processInboundWebhookNotification({
        clientState: 'test-client-state-secret',
        changeType: 'created',
        resource: "chats('19:external-chat@unq.gbl.spaces')/messages('1690003')",
      });

      expect(result).toEqual({
        status: 'PROCESSED',
        conversationId: 'conv-external-direct-1',
        lngMessageId: 'lng-msg-guest-1',
        teamsMessageId: '1690003',
      });

      expect(authPublic.ensureTeamsAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          entraUserId: 'external-entra-guest-id',
          email: 'partner@external.com',
          displayName: 'Guest Partner',
          isExternal: true,
        }),
      );

      expect(teamsChatMappingRepository.createOrUpdateMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-external-direct-1',
          teamsChatId: '19:external-chat@unq.gbl.spaces',
          isExternal: true,
        }),
      );
    });

    test('processes inbound group chat message, creates TEAM conversation and notifies members', async () => {
      teamsMessageMappingRepository.findByTeamsMessageId.mockResolvedValue(null);

      graphClient.getChatMessage.mockResolvedValue({
        id: '1690004',
        messageType: 'message',
        body: {
          contentType: 'text',
          content: 'Hello everyone in the group!',
        },
        from: {
          user: {
            id: 'entra-user-alice',
            displayName: 'Alice In Group',
            email: 'alice@lngwork.co',
            userIdentityType: 'aadUser',
          },
        },
      });

      graphClient.getChat.mockResolvedValue({
        id: '19:group-chat-multi@unq.gbl.spaces',
        chatType: 'group',
        topic: 'Engineering Pod',
        members: [
          { userId: 'entra-user-alice', displayName: 'Alice In Group', email: 'alice@lngwork.co' },
          { userId: 'entra-user-bob', displayName: 'Bob Member', email: 'bob@lngwork.co' },
          { userId: 'entra-user-charlie', displayName: 'Charlie Member', email: 'charlie@lngwork.co' },
        ],
      });

      teamsUserMappingRepository.findByEntraUserId
        .mockResolvedValueOnce({ accountId: 'acc-alice' })
        .mockResolvedValueOnce({ accountId: 'acc-bob' })
        .mockResolvedValueOnce({ accountId: 'acc-charlie' });

      teamsChatMappingRepository.findByTeamsChatId.mockResolvedValue(null);

      chatPublic.createConversation.mockResolvedValue({
        id: 'conv-group-team-1',
        type: 'TEAM',
        title: 'Engineering Pod',
        participantAccountIds: ['acc-alice', 'acc-bob', 'acc-charlie'],
      });

      chatPublic.sendMessage.mockResolvedValue({
        id: 'lng-msg-group-1',
        conversationId: 'conv-group-team-1',
        body: 'Hello everyone in the group!',
      });

      const result = await teamsSyncService.processInboundWebhookNotification({
        clientState: 'test-client-state-secret',
        changeType: 'created',
        resource: "chats('19:group-chat-multi@unq.gbl.spaces')/messages('1690004')",
      });

      expect(result).toEqual({
        status: 'PROCESSED',
        conversationId: 'conv-group-team-1',
        lngMessageId: 'lng-msg-group-1',
        teamsMessageId: '1690004',
      });

      expect(chatPublic.createConversation).toHaveBeenCalledWith(
        {
          type: 'TEAM',
          title: 'Engineering Pod',
          participantAccountIds: ['acc-alice', 'acc-bob', 'acc-charlie'],
        },
        { accountId: 'acc-alice' },
      );

      expect(teamsChatMappingRepository.createOrUpdateMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-group-team-1',
          teamsChatId: '19:group-chat-multi@unq.gbl.spaces',
          chatType: 'group',
        }),
      );

      expect(notificationPublic.notify).toHaveBeenCalledTimes(2);
    });
  });

  describe('syncInboundMessagesForConversation', () => {
    it('pulls unmapped messages from Teams chat and imports them into LNG conversation', () => {
      chatPublic.getConversationById.mockResolvedValue({
        id: 'conv-sync-1',
        type: 'DIRECT',
        participantAccountIds: ['acc-1', 'acc-2'],
      });
      teamsChatMappingRepository.findByConversationId.mockResolvedValue({
        teamsChatId: '19:entra-1_entra-2@unq.gbl.spaces',
      });
      graphClient.listChatMessages.mockResolvedValue({
        value: [
          {
            id: 'teams-msg-old',
            messageType: 'message',
            body: { content: 'Old message' },
            from: { user: { id: 'entra-1', displayName: 'User 1' } },
            createdDateTime: '2026-10-14T06:00:00Z',
          },
          {
            id: 'teams-msg-new',
            messageType: 'message',
            body: { content: 'New message from Teams' },
            from: { user: { id: 'entra-2', displayName: 'User 2' } },
            createdDateTime: '2026-10-14T06:10:00Z',
          },
        ],
      });
      teamsMessageMappingRepository.findByTeamsChatAndMessageId.mockImplementation(
        async (_chatId, msgId) => (msgId === 'teams-msg-old' ? { id: 'existing-map' } : null),
      );

      teamsUserMappingRepository.findByEntraUserId.mockResolvedValue({
        accountId: 'acc-2',
      });
      chatPublic.sendMessage.mockResolvedValue({
        id: 'lng-msg-new',
        conversationId: 'conv-sync-1',
        body: 'New message from Teams',
      });

      return teamsSyncService.syncInboundMessagesForConversation({ conversationId: 'conv-sync-1' }).then((result) => {
        expect(result).toEqual({
          status: 'SYNCED',
          syncedCount: 1,
          teamsChatId: '19:entra-1_entra-2@unq.gbl.spaces',
        });
        expect(chatPublic.sendMessage).toHaveBeenCalledWith(
          'conv-sync-1',
          expect.objectContaining({
            body: 'New message from Teams',
          }),
          { accountId: 'acc-2' },
          { source: 'TEAMS_INBOUND' },
        );
        expect(teamsMessageMappingRepository.createMapping).toHaveBeenCalledWith({
          lngMessageId: 'lng-msg-new',
          teamsMessageId: 'teams-msg-new',
          teamsChatId: '19:entra-1_entra-2@unq.gbl.spaces',
          conversationId: 'conv-sync-1',
          direction: TEAMS_SYNC_DIRECTIONS.INBOUND,
          status: TEAMS_SYNC_STATUSES.SYNCED,
        });
      });
    });
  });

  describe('ensureWebhookSubscription', () => {
    it('supersedes active subscription and creates a new one when notificationUrl changes', async () => {
      teamsSubscriptionRepository.findActiveSubscription.mockResolvedValue({
        subscriptionId: 'old-sub-id',
        notificationUrl: 'https://old-ngrok.app/webhook',
        expirationDateTime: new Date(Date.now() + 30 * 60 * 1000),
      });
      graphClient.createSubscription.mockResolvedValue({
        id: 'new-sub-id',
        expirationDateTime: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
      });
      teamsSubscriptionRepository.saveSubscription.mockResolvedValue({
        subscriptionId: 'new-sub-id',
        status: 'ACTIVE',
      });

      const result = await teamsSyncService.ensureWebhookSubscription();

      expect(graphClient.deleteSubscription).toHaveBeenCalledWith('old-sub-id');
      expect(teamsSubscriptionRepository.updateStatus).toHaveBeenCalledWith('old-sub-id', 'SUPERSEDED');
      expect(graphClient.createSubscription).toHaveBeenCalled();
      expect(teamsSubscriptionRepository.saveSubscription).toHaveBeenCalled();
      expect(result.status).toBe('CREATED');
    });
  });
});
