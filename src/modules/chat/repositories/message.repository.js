const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const Message = require('../models/message.model');
const MessageReadState = require('../models/messageReadState.model');

async function create(payload) {
  const message = await Message.create(payload);
  return message.toObject();
}

async function findById(id) {
  return Message.findById(id).lean();
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

module.exports = {
  create,
  findById,
  listByConversation,
  markRead,
};
