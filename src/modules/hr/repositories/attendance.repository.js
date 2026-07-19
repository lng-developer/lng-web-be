const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { hrAttendanceStatuses } = require('../constants/hr.constants');
const AttendanceDaily = require('../models/attendanceDaily.model');

function buildFilter({ dateFrom, dateTo, profileId, scopeFilters, status } = {}) {
  const filter = {};
  if (profileId) filter.profileId = profileId;
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.workDateKey = {};
    if (dateFrom) filter.workDateKey.$gte = dateFrom;
    if (dateTo) filter.workDateKey.$lte = dateTo;
  }
  if (scopeFilters?.length) filter.$or = scopeFilters;
  return filter;
}

async function createDaily(payload, { session } = {}) {
  const [record] = await AttendanceDaily.create([payload], { session });
  return record.toObject();
}

async function findById(id) {
  return AttendanceDaily.findById(id).lean();
}

async function findByProfileAndWorkDate(profileId, workDateKey, { session } = {}) {
  return AttendanceDaily.findOne({ profileId, workDateKey }).session(session || null).lean();
}

async function findByLeaveRequestId(profileId, requestId, { session } = {}) {
  return AttendanceDaily.find({ profileId, 'leaveSegments.requestId': requestId })
    .session(session || null)
    .lean();
}

async function findOpenByProfile(profileId) {
  return AttendanceDaily.findOne({
    profileId,
    checkInAt: { $ne: null },
    checkOutAt: null,
  }).sort({ checkInAt: -1, _id: -1 }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildFilter(query);
  const statuses = Object.values(hrAttendanceStatuses);
  const [items, total, ...statusTotals] = await Promise.all([
    AttendanceDaily.find(filter)
      .sort({ workDateKey: -1, checkInAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    AttendanceDaily.countDocuments(filter),
    ...statuses.map((status) => AttendanceDaily.countDocuments({ $and: [filter, { status }] })),
  ]);
  return {
    items,
    pagination: { page, limit, total },
    summary: {
      total,
      statusCounts: Object.fromEntries(statuses.map((status, index) => [status, statusTotals[index]])),
    },
  };
}

async function updateById(id, patch) {
  return AttendanceDaily.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function closeOpenById(id, patch) {
  return AttendanceDaily.findOneAndUpdate(
    { _id: id, checkOutAt: null },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function appendAdjustment(id, expectedUpdatedAt, patch, adjustment) {
  return AttendanceDaily.findOneAndUpdate(
    { _id: id, updatedAt: expectedUpdatedAt },
    { $set: patch, $push: { manualAdjustments: adjustment } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateLeaveProjection(id, patch, { requireAvailableHalfDay = false, session } = {}) {
  const filter = { _id: id };
  if (requireAvailableHalfDay) {
    filter.checkInAt = null;
    filter.$expr = {
      $lt: [{ $sum: { $ifNull: ['$leaveSegments.units', []] } }, 2],
    };
  }
  return AttendanceDaily.findOneAndUpdate(
    filter,
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function removeById(id, { session } = {}) {
  return AttendanceDaily.findOneAndDelete({ _id: id }, { session }).lean();
}

module.exports = {
  appendAdjustment,
  closeOpenById,
  createDaily,
  findById,
  findByLeaveRequestId,
  findByProfileAndWorkDate,
  findOpenByProfile,
  list,
  removeById,
  updateLeaveProjection,
  updateById,
};
