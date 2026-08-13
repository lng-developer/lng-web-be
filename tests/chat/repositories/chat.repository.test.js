const mongoose = require('mongoose');
const { startIsolatedMongo } = require('../../helpers/isolatedMongo');
const Conversation = require('../../../src/modules/chat/models/conversation.model');
const Message = require('../../../src/modules/chat/models/message.model');
const MessageReadState = require('../../../src/modules/chat/models/messageReadState.model');
const conversationRepository = require('../../../src/modules/chat/repositories/conversation.repository');
const messageRepository = require('../../../src/modules/chat/repositories/message.repository');

const accountId = '660000000000000000000101';
const otherAccountId = '660000000000000000000102';
const shopId = '660000000000000000000201';

describe('chat repositories', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await startIsolatedMongo('chat_repository_test');
    await Promise.all([Conversation.init(), Message.init(), MessageReadState.init()]);
  });

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Conversation.deleteMany({}),
      Message.deleteMany({}),
      MessageReadState.deleteMany({}),
    ]);
  });

  test('listForAccount returns only participant conversations sorted by latest activity', async () => {
    const older = await conversationRepository.create({
      type: 'DIRECT',
      shopId,
      participantAccountIds: [accountId],
      lastMessageAt: new Date('2026-08-11T01:00:00.000Z'),
    });
    const newer = await conversationRepository.create({
      type: 'DIRECT',
      shopId,
      participantAccountIds: [accountId, otherAccountId],
      lastMessageAt: new Date('2026-08-11T02:00:00.000Z'),
    });
    await conversationRepository.create({
      type: 'DIRECT',
      shopId,
      participantAccountIds: [otherAccountId],
      lastMessageAt: new Date('2026-08-11T03:00:00.000Z'),
    });

    const result = await conversationRepository.listForAccount(accountId);

    expect(result.pagination.total).toBe(2);
    expect(result.items.map((item) => String(item._id))).toEqual([
      String(newer._id),
      String(older._id),
    ]);
  });

  test('message list returns chronological page and markRead upserts one state per account', async () => {
    const conversation = await conversationRepository.create({
      type: 'DIRECT',
      participantAccountIds: [accountId],
    });
    const first = await messageRepository.create({
      conversationId: conversation._id,
      senderAccountId: accountId,
      body: 'first',
    });
    const second = await messageRepository.create({
      conversationId: conversation._id,
      senderAccountId: accountId,
      body: 'second',
    });
    await Message.findByIdAndUpdate(first._id, { $set: { createdAt: new Date('2026-08-11T01:00:00.000Z') } });
    await Message.findByIdAndUpdate(second._id, { $set: { createdAt: new Date('2026-08-11T02:00:00.000Z') } });

    const messages = await messageRepository.listByConversation(conversation._id);
    const firstRead = await messageRepository.markRead(conversation._id, accountId, new Date('2026-08-11T03:00:00.000Z'));
    const secondRead = await messageRepository.markRead(conversation._id, accountId, new Date('2026-08-11T04:00:00.000Z'));

    expect(messages.items.map((item) => item.body)).toEqual(['first', 'second']);
    expect(String(firstRead._id)).toBe(String(secondRead._id));
    expect(secondRead.lastReadAt).toEqual(new Date('2026-08-11T04:00:00.000Z'));
    expect(await MessageReadState.countDocuments({
      conversationId: new mongoose.Types.ObjectId(conversation._id),
      accountId: new mongoose.Types.ObjectId(accountId),
    })).toBe(1);
  });

  test('summarizeConversationStates reports unread messages from other accounts', async () => {
    const conversation = await conversationRepository.create({
      type: 'DIRECT',
      participantAccountIds: [accountId, otherAccountId],
    });
    const ownMessage = await messageRepository.create({
      conversationId: conversation._id,
      senderAccountId: accountId,
      body: 'own',
    });
    const unreadMessage = await messageRepository.create({
      conversationId: conversation._id,
      senderAccountId: otherAccountId,
      body: 'new',
    });
    await Message.findByIdAndUpdate(ownMessage._id, { $set: { createdAt: new Date('2026-08-11T01:00:00.000Z') } });
    await Message.findByIdAndUpdate(unreadMessage._id, { $set: { createdAt: new Date('2026-08-11T02:00:00.000Z') } });
    await messageRepository.markRead(conversation._id, accountId, new Date('2026-08-11T01:30:00.000Z'));

    const states = await messageRepository.summarizeConversationStates([conversation._id], accountId);
    const state = states.get(String(conversation._id));

    expect(state).toMatchObject({
      unreadCount: 1,
      hasUnreadFromOthers: true,
    });
    expect(String(state.lastMessageSenderAccountId)).toBe(otherAccountId);
  });
});
