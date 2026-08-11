jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  listChatDirectory: jest.fn(),
}));

jest.mock('../../../src/modules/media/public', () => ({
  assertMediaAssetReady: jest.fn(),
  attachAssetsToChat: jest.fn(),
  getAssetsByIds: jest.fn(),
}));

jest.mock('../../../src/modules/hr/public', () => ({
  listEmployeeProfilesByAccountIds: jest.fn(),
}));

jest.mock('../../../src/modules/notification/public', () => ({
  notify: jest.fn(),
}));

jest.mock('../../../src/modules/chat/repositories/conversation.repository', () => ({
  create: jest.fn(),
  findByDirectKey: jest.fn(),
  findById: jest.fn(),
  listForAccount: jest.fn(),
  updateLastMessage: jest.fn(),
}));

jest.mock('../../../src/modules/chat/repositories/message.repository', () => ({
  create: jest.fn(),
  listByConversation: jest.fn(),
  markRead: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const hrPublic = require('../../../src/modules/hr/public');
const mediaPublic = require('../../../src/modules/media/public');
const notificationPublic = require('../../../src/modules/notification/public');
const conversationRepository = require('../../../src/modules/chat/repositories/conversation.repository');
const messageRepository = require('../../../src/modules/chat/repositories/message.repository');
const service = require('../../../src/modules/chat/services/chat.service');

const conversationId = '660000000000000000000001';
const accountId = '660000000000000000000002';
const mentionId = '660000000000000000000003';
const assetId = '660000000000000000000004';
const shopId = '660000000000000000000005';

describe('chat service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValue([]);
    mediaPublic.assertMediaAssetReady.mockResolvedValue({ _id: assetId });
    mediaPublic.attachAssetsToChat.mockResolvedValue(undefined);
    mediaPublic.getAssetsByIds.mockResolvedValue([{
      _id: assetId,
      originalFilename: 'proof.png',
      mimeType: 'image/png',
      size: 1234,
    }]);
    conversationRepository.findById.mockResolvedValue({
      _id: conversationId,
      shopId,
      participantAccountIds: [accountId, mentionId],
    });
    messageRepository.create.mockResolvedValue({
      _id: '660000000000000000000006',
      conversationId,
      senderAccountId: accountId,
      body: 'hello',
      assetIds: [assetId],
      mentions: [mentionId],
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
    });
  });

  test('sendMessage validates shop access, media assets, and notifies mentions', async () => {
    const result = await service.sendMessage(conversationId, {
      body: 'hello',
      assetIds: [assetId],
      mentions: [mentionId],
    }, { accountId });

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
      scopeType: 'shop',
      scopeId: shopId,
    });
    expect(mediaPublic.assertMediaAssetReady).toHaveBeenCalledWith(assetId);
    expect(mediaPublic.attachAssetsToChat).toHaveBeenCalledWith([assetId], conversationId);
    expect(messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      senderAccountId: accountId,
      assetIds: [assetId],
    }));
    expect(notificationPublic.notify).toHaveBeenCalledWith(expect.objectContaining({
      recipientAccountId: mentionId,
      type: 'CHAT_MENTION',
    }));
    expect(result.body).toBe('hello');
    expect(result.assets[0]).toMatchObject({
      id: assetId,
      originalFilename: 'proof.png',
      mimeType: 'image/png',
      downloadUrl: `/api/media/assets/${assetId}/download`,
    });
  });

  test('listParticipants delegates to auth public directory and excludes the current account', async () => {
    authPublic.listChatDirectory.mockResolvedValue({
      items: [
        { id: accountId, email: 'admin@lng.co' },
        { id: mentionId, email: 'user@lng.co' },
      ],
    });
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValue([
      { accountId: mentionId, employeeCode: 'J2506' },
    ]);

    const result = await service.listParticipants({ search: 'user' }, { accountId }, new Set([accountId]));

    expect(authPublic.listChatDirectory).toHaveBeenCalledWith({ search: 'user' });
    expect(result.items[0].email).toBe('user@lng.co');
    expect(result.items[0].employeeCode).toBe('J2506');
    expect(result.items[0].presence).toBe('OFFLINE');
    expect(result.items).toHaveLength(1);
  });

  test('listParticipants sorts online accounts before offline accounts', async () => {
    authPublic.listChatDirectory.mockResolvedValue({
      items: [
        { id: mentionId, email: 'z-offline@lng.co' },
        { id: assetId, email: 'a-online@lng.co' },
      ],
    });

    const result = await service.listParticipants({}, { accountId }, new Set([assetId]));

    expect(result.items.map((item) => item.email)).toEqual(['a-online@lng.co', 'z-offline@lng.co']);
  });

  test('createConversation reuses an existing direct conversation for the same participants', async () => {
    conversationRepository.findByDirectKey.mockResolvedValue({
      _id: conversationId,
      type: 'DIRECT',
      participantAccountIds: [accountId, mentionId],
    });

    const result = await service.createConversation({
      type: 'DIRECT',
      participantAccountIds: [mentionId],
    }, { accountId });

    expect(conversationRepository.findByDirectKey).toHaveBeenCalledWith(`${accountId}:${mentionId}`);
    expect(conversationRepository.create).not.toHaveBeenCalled();
    expect(result.id).toBe(conversationId);
  });

  test('sendMessage rejects non-participants', async () => {
    await expect(service.sendMessage(conversationId, { body: 'nope' }, {
      accountId: '660000000000000000000099',
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});
