const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const Conversation = require('../models/conversation.model');

function buildParticipantFilter(accountId) {
  return {
    participantAccountIds: accountId,
  };
}

async function create(payload) {
  const conversation = await Conversation.create(payload);
  return conversation.toObject();
}

async function findById(id) {
  return Conversation.findById(id).lean();
}

async function findByDirectKey(directKey) {
  return Conversation.findOne({ directKey }).lean();
}

async function listForAccount(accountId, query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildParticipantFilter(accountId);
  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Conversation.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function updateLastMessage(conversationId, message) {
  return Conversation.findByIdAndUpdate(
    conversationId,
    {
      $set: {
        lastMessageAt: message.createdAt || new Date(),
        lastMessagePreview: String(message.body || '').slice(0, 160),
      },
    },
    { returnDocument: 'after' },
  ).lean();
}

module.exports = {
  create,
  findByDirectKey,
  findById,
  listForAccount,
  updateLastMessage,
};
