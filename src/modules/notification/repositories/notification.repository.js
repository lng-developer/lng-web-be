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

async function migrateLegacyItems(items = [], { apply = false } = {}) {
  if (!apply || !items.length) return { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  try {
    const result = await Notification.bulkWrite(items.map((item) => {
      const { _id, ...payload } = item;
      return {
        updateOne: {
          filter: { recipientAccountId: item.recipientAccountId, deduplicationKey: item.deduplicationKey },
          update: { $set: payload, ...(item._id ? { $setOnInsert: { _id: item._id } } : {}) },
          upsert: true,
        },
      };
    }), { ordered: false });
    const inserted = Number(result.upsertedCount || 0);
    const updated = Number(result.modifiedCount || 0);
    return { inserted, updated, unchanged: Math.max(0, Number(result.matchedCount || 0) - updated), failed: 0 };
  } catch (error) {
    return { inserted: 0, updated: 0, unchanged: 0, failed: error.writeErrors?.length || items.length };
  }
}

module.exports = {
  countUnreadForRecipient,
  create,
  findByDeduplicationKey,
  listForRecipient,
  markAllReadForRecipient,
  markReadForRecipient,
  migrateLegacyItems,
};
