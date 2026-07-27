const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const Notification = require('../models/notification.model');

async function create(payload) {
  const notification = await Notification.create(payload);
  return notification.toObject();
}

async function findByDeduplicationKey(recipientAccountId, deduplicationKey) {
  return Notification.findOne({ recipientAccountId, deduplicationKey }).lean();
}

async function listForRecipient({ recipientAccountId, unreadOnly = false, ...pagination } = {}) {
  const { page, limit } = normalizePagination(pagination);
  const filter = {
    recipientAccountId,
    ...(unreadOnly ? { readAt: null } : {}),
  };
  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ readAt: 1, createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function countUnreadForRecipient(recipientAccountId) {
  return Notification.countDocuments({ recipientAccountId, readAt: null });
}

async function markReadForRecipient(id, recipientAccountId, readAt) {
  return Notification.findOneAndUpdate(
    { _id: id, recipientAccountId },
    { $set: { readAt } },
    { returnDocument: 'after' },
  ).lean();
}

async function markAllReadForRecipient(recipientAccountId, readAt) {
  return Notification.updateMany(
    { recipientAccountId, readAt: null },
    { $set: { readAt } },
  );
}

module.exports = {
  countUnreadForRecipient,
  create,
  findByDeduplicationKey,
  listForRecipient,
  markAllReadForRecipient,
  markReadForRecipient,
};
