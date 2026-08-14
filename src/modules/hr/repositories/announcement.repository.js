const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const Announcement = require('../models/announcement.model');
const EmployeeProfile = require('../models/employeeProfile.model');

const ELIGIBLE_STATUSES = ['ACTIVE', 'PROBATION', 'ON_LEAVE'];

async function create(payload) {
  return (await Announcement.create(payload)).toObject();
}

async function findById(id) {
  return Announcement.findOne({ _id: id, isDeleted: false }).lean();
}

async function list({ filter = {}, page, limit } = {}) {
  const pagination = normalizePagination({ page, limit });
  const query = { isDeleted: false, ...filter };
  const [items, total] = await Promise.all([
    Announcement.find(query).sort({ isPinned: -1, publishedAt: -1, createdAt: -1, _id: -1 })
      .skip(getPaginationOffset(pagination)).limit(pagination.limit).lean(),
    Announcement.countDocuments(query),
  ]);
  return { items, pagination: { ...pagination, total } };
}

async function update(id, patch) {
  return Announcement.findOneAndUpdate(
    { _id: id, isDeleted: false }, { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function softDelete(id, deletedAt) {
  return update(id, { isDeleted: true, deletedAt });
}

async function claimDueScheduled(now) {
  return Announcement.findOneAndUpdate(
    { status: 'SCHEDULED', scheduledAt: { $lte: now }, isDeleted: false },
    { $set: { status: 'PUBLISHED', publishedAt: now, publishedNotifiedAt: null } },
    { returnDocument: 'after', runValidators: true, sort: { scheduledAt: 1, _id: 1 } },
  ).lean();
}

async function listPendingPublicationNotifications(limit = 100) {
  return Announcement.find({ status: 'PUBLISHED', publishedNotifiedAt: null, isDeleted: false })
    .sort({ publishedAt: 1, _id: 1 }).limit(limit).lean();
}

async function listDueReminders(now, limit = 100) {
  return Announcement.find({
    status: 'PUBLISHED', reminderSentAt: null, remindAt: { $ne: null, $lte: now }, isDeleted: false,
  }).sort({ remindAt: 1, _id: 1 }).limit(limit).lean();
}

async function markPublishedNotified(id, occurredAt) {
  return Announcement.updateOne(
    { _id: id, status: 'PUBLISHED', publishedNotifiedAt: null },
    { $set: { publishedNotifiedAt: occurredAt } },
  );
}

async function markReminderSent(id, occurredAt) {
  return Announcement.updateOne(
    { _id: id, status: 'PUBLISHED', reminderSentAt: null },
    { $set: { reminderSentAt: occurredAt } },
  );
}

async function listAudienceProfiles(announcement) {
  const filter = { isDeleted: false, status: { $in: ELIGIBLE_STATUSES } };
  if (!announcement.sendToAll) {
    filter.$or = [];
    if (announcement.targetDepartmentIds?.length) filter.$or.push({ departmentId: { $in: announcement.targetDepartmentIds } });
    if (announcement.targetProfileIds?.length) filter.$or.push({ _id: { $in: announcement.targetProfileIds } });
    if (!filter.$or.length) return [];
  }
  return EmployeeProfile.find(filter).select('_id accountId').lean();
}

async function aggregateDashboardCounts(now = new Date()) {
  const [row = {}] = await Announcement.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        published: { $sum: { $cond: [{ $eq: ['$status', 'PUBLISHED'] }, 1, 0] } },
        scheduled: { $sum: { $cond: [{ $eq: ['$status', 'SCHEDULED'] }, 1, 0] } },
        pinned: { $sum: { $cond: ['$isPinned', 1, 0] } },
        urgent: { $sum: { $cond: [{ $eq: ['$priority', 'URGENT'] }, 1, 0] } },
        dueReminders: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'PUBLISHED'] },
                  { $eq: [{ $ifNull: ['$reminderSentAt', null] }, null] },
                  { $ne: ['$remindAt', null] },
                  { $lte: ['$remindAt', now] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return row;
}

module.exports = {
  aggregateDashboardCounts,
  claimDueScheduled,
  create,
  findById,
  list,
  listAudienceProfiles,
  listDueReminders,
  listPendingPublicationNotifications,
  markPublishedNotified,
  markReminderSent,
  softDelete,
  update,
};
