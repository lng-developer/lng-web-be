const { toConversationDto, toMessageDto } = require('../../../src/modules/chat/dtos/chat.dto');

describe('chat dto', () => {
  test('conversation dto exposes stable ids without raw document internals', () => {
    const dto = toConversationDto({
      _id: '660000000000000000000001',
      type: 'ORDER',
      title: 'Order chat',
      shopId: '660000000000000000000002',
      relatedResource: { type: 'ORDER', id: 'ORDER-1' },
      participantAccountIds: ['660000000000000000000003'],
      lastMessageAt: new Date('2026-08-11T01:00:00.000Z'),
      lastMessagePreview: 'hello',
      __v: 0,
    });

    expect(dto).toEqual({
      id: '660000000000000000000001',
      type: 'ORDER',
      title: 'Order chat',
      shopId: '660000000000000000000002',
      relatedResource: { type: 'ORDER', id: 'ORDER-1' },
      participantAccountIds: ['660000000000000000000003'],
      lastMessageAt: new Date('2026-08-11T01:00:00.000Z'),
      lastMessagePreview: 'hello',
      createdAt: undefined,
      updatedAt: undefined,
    });
    expect(dto).not.toHaveProperty('_id');
    expect(dto).not.toHaveProperty('__v');
  });

  test('deleted message dto hides user content and attachments', () => {
    const dto = toMessageDto({
      _id: '660000000000000000000011',
      conversationId: '660000000000000000000001',
      senderAccountId: '660000000000000000000003',
      body: 'secret',
      assetIds: ['660000000000000000000004'],
      mentions: ['660000000000000000000005'],
      deletedAt: new Date('2026-08-11T02:00:00.000Z'),
    });

    expect(dto).toEqual(expect.objectContaining({
      id: '660000000000000000000011',
      body: '',
      assetIds: [],
      mentions: [],
      deletedAt: new Date('2026-08-11T02:00:00.000Z'),
    }));
  });
});
