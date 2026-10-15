const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const Message = require('../models/message.model');
const MessageReadState = require('../models/messageReadState.model');

function toObjectId(value) {
  return value instanceof Message.base.Types.ObjectId ? value : new Message.base.Types.ObjectId(value);
}

async function create(payload) {
  const message = await Message.create(payload);
  return message.toObject();
}

async function findById(id) {
  return Message.findById(id).lean();
}

async function findReplyTargets(conversationId, ids) {
  return Message.find({ _id: { $in: ids }, conversationId, deletedAt: null })
    .select('_id senderAccountId body assetIds').lean();
}

async function listByConversation(conversationId, query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = { conversationId, deletedAt: null };
  const [items, total] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Message.countDocuments(filter),
  ]);
  return { items: items.reverse(), pagination: { page, limit, total } };
}

async function markRead(conversationId, accountId, lastReadAt) {
  return MessageReadState.findOneAndUpdate(
    { conversationId, accountId },
    { $set: { lastReadAt } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}

async function summarizeConversationStates(conversationIds = [], accountId) {
  if (!conversationIds.length || !accountId) return new Map();
  const ids = conversationIds.map(toObjectId);
  const accountObjectId = toObjectId(accountId);
  const [readStates, unreadRows, latestRows] = await Promise.all([
    MessageReadState.find({ conversationId: { $in: ids }, accountId: accountObjectId }).lean(),
    Message.aggregate([
      {
        $match: {
          conversationId: { $in: ids },
          senderAccountId: { $ne: accountObjectId },
          deletedAt: null,
        },
      },
      {
        $lookup: {
          from: MessageReadState.collection.name,
          let: { conversationId: '$conversationId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$conversationId', '$$conversationId'] },
                    { $eq: ['$accountId', accountObjectId] },
                  ],
                },
              },
            },
          ],
          as: 'readState',
        },
      },
      { $unwind: { path: '$readState', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $expr: {
            $or: [
              { $not: ['$readState.lastReadAt'] },
              { $gt: ['$createdAt', '$readState.lastReadAt'] },
            ],
          },
        },
      },
      { $group: { _id: '$conversationId', unreadCount: { $sum: 1 } } },
    ]),
    Message.aggregate([
      { $match: { conversationId: { $in: ids }, deletedAt: null } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$conversationId', senderAccountId: { $first: '$senderAccountId' } } },
    ]),
  ]);

  const states = new Map(ids.map((id) => [String(id), {
    lastReadAt: null,
    lastMessageSenderAccountId: null,
    unreadCount: 0,
    hasUnreadFromOthers: false,
  }]));
  readStates.forEach((state) => {
    const current = states.get(String(state.conversationId));
    if (current) current.lastReadAt = state.lastReadAt;
  });
  latestRows.forEach((row) => {
    const current = states.get(String(row._id));
    if (current) current.lastMessageSenderAccountId = row.senderAccountId;
  });
  unreadRows.forEach((row) => {
    const current = states.get(String(row._id));
    if (current) {
      current.unreadCount = row.unreadCount;
      current.hasUnreadFromOthers = row.unreadCount > 0;
    }
  });
  return states;
}

module.exports = {
  create,
  findById,
  findReplyTargets,
  listByConversation,
  markRead,
  summarizeConversationStates,
};
