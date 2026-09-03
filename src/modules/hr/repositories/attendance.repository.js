const mongoose = require("mongoose");
const {
  getPaginationOffset,
  normalizePagination,
} = require("../../../shared/utils/pagination");
const { hrAttendanceStatuses } = require("../constants/hr.constants");
const AttendanceDaily = require("../models/attendanceDaily.model");

function buildFilter({
  dateFrom,
  dateTo,
  exceptionsOnly,
  lateOnly,
  profileId,
  scopeFilters,
  status,
} = {}) {
  const filter = {};
  if (profileId) filter.profileId = profileId;
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.workDateKey = {};
    if (dateFrom) filter.workDateKey.$gte = dateFrom;
    if (dateTo) filter.workDateKey.$lte = dateTo;
  }
  const clauses = [];
  if (scopeFilters?.length) clauses.push({ $or: scopeFilters });
  if (exceptionsOnly) {
    clauses.push({
      $or: [
        { status: { $ne: hrAttendanceStatuses.PRESENT } },
        { lateMinutes: { $gt: 0 } },
        { earlyLeaveMinutes: { $gt: 0 } },
      ],
    });
  }
  if (lateOnly) clauses.push({ lateMinutes: { $gt: 0 } });
  if (clauses.length) filter.$and = clauses;
  return filter;
}

async function createDaily(payload, { session } = {}) {
  const [record] = await AttendanceDaily.create([payload], { session });
  return record.toObject();
}

async function findById(id) {
  return AttendanceDaily.findById(id).lean();
}

async function findByProfileAndWorkDate(
  profileId,
  workDateKey,
  { session } = {},
) {
  return AttendanceDaily.findOne({ profileId, workDateKey })
    .session(session || null)
    .lean();
}

async function findByLeaveRequestId(profileId, requestId, { session } = {}) {
  return AttendanceDaily.find({
    profileId,
    "leaveSegments.requestId": requestId,
  })
    .session(session || null)
    .lean();
}

async function findOpenByProfile(profileId) {
  return AttendanceDaily.findOne({
    profileId,
    checkInAt: { $ne: null },
    checkOutAt: null,
  })
    .sort({ checkInAt: -1, _id: -1 })
    .lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { maxLimit: 1000 });
  const filter = buildFilter(query);
  const statuses = Object.values(hrAttendanceStatuses);
  const [items, statusRows] = await Promise.all([
    AttendanceDaily.find(filter)
      .sort({ workDateKey: -1, checkInAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    AttendanceDaily.aggregate([
      { $match: filter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  const statusCounts = Object.fromEntries(
    statuses.map((status) => [status, 0]),
  );
  statusRows.forEach((row) => {
    statusCounts[row._id] = row.count;
  });
  const total = statusRows.reduce((sum, row) => sum + row.count, 0);
  return {
    items,
    pagination: { page, limit, total },
    summary: {
      total,
      statusCounts,
    },
  };
}

async function listByProfileIdsAndDateRange(
  profileIds,
  dateFrom,
  dateTo,
  { shiftId, exceptionsOnly, lateOnly } = {},
) {
  if (!profileIds.length) return [];
  const filter = buildFilter({
    profileId: { $in: profileIds },
    dateFrom,
    dateTo,
    exceptionsOnly,
  });
  if (shiftId) filter["scheduleSnapshot.shift.id"] = String(shiftId);
  return AttendanceDaily.find(filter).sort({ workDateKey: 1, _id: 1 }).lean();
}

async function listMatchingProfileIdsByDateRange(
  profileIds,
  dateFrom,
  dateTo,
  { exceptionsOnly, lateOnly, shiftId } = {},
) {
  if (!profileIds.length) return [];
  const filter = buildFilter({
    profileId: { $in: profileIds },
    dateFrom,
    dateTo,
    exceptionsOnly,
    lateOnly,
    lateOnly,
  });
  if (shiftId) filter["scheduleSnapshot.shift.id"] = String(shiftId);
  return AttendanceDaily.distinct("profileId", filter);
}

async function summarizeByProfileIdsAndDateRange(
  profileIds,
  dateFrom,
  dateTo,
  { shiftId } = {},
) {
  if (!profileIds.length)
    return {
      totalRecords: 0,
      statusCounts: {},
      manualAdjustmentCount: 0,
      lateCount: 0,
    };
  const aggregateProfileIds = profileIds.map(
    (profileId) => new mongoose.Types.ObjectId(profileId),
  );
  const filter = buildFilter({
    profileId: { $in: aggregateProfileIds },
    dateFrom,
    dateTo,
  });
  if (shiftId) filter["scheduleSnapshot.shift.id"] = String(shiftId);
  const rows = await AttendanceDaily.aggregate([
    { $match: filter },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        manualAdjustmentCount: {
          $sum: { $size: { $ifNull: ["$manualAdjustments", []] } },
        },
        lateCount: { $sum: { $cond: [{ $gt: ["$lateMinutes", 0] }, 1, 0] } },
      },
    },
  ]);
  return rows.reduce(
    (summary, row) => ({
      totalRecords: summary.totalRecords + row.count,
      statusCounts: { ...summary.statusCounts, [row._id]: row.count },
      manualAdjustmentCount:
        summary.manualAdjustmentCount + row.manualAdjustmentCount,
      lateCount: summary.lateCount + row.lateCount,
    }),
    {
      totalRecords: 0,
      statusCounts: {},
      manualAdjustmentCount: 0,
      lateCount: 0,
    },
  );
}

async function updateById(id, patch) {
  return AttendanceDaily.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: "after", runValidators: true },
  ).lean();
}

async function closeOpenById(id, patch) {
  return AttendanceDaily.findOneAndUpdate(
    { _id: id, checkOutAt: null },
    { $set: patch },
    { returnDocument: "after", runValidators: true },
  ).lean();
}

async function appendAdjustment(id, expectedUpdatedAt, patch, adjustment) {
  return AttendanceDaily.findOneAndUpdate(
    { _id: id, updatedAt: expectedUpdatedAt },
    { $set: patch, $push: { manualAdjustments: adjustment } },
    { returnDocument: "after", runValidators: true },
  ).lean();
}

async function updateLeaveProjection(
  id,
  patch,
  { requireAvailableHalfDay = false, session } = {},
) {
  const filter = { _id: id };
  if (requireAvailableHalfDay) {
    filter.checkInAt = null;
    filter.$expr = {
      $lt: [{ $sum: { $ifNull: ["$leaveSegments.units", []] } }, 2],
    };
  }
  return AttendanceDaily.findOneAndUpdate(
    filter,
    { $set: patch },
    { returnDocument: "after", runValidators: true, session },
  ).lean();
}

async function aggregateDashboard(workDateKey) {
  const leaveStatuses = [
    hrAttendanceStatuses.PAID_LEAVE,
    hrAttendanceStatuses.UNPAID_LEAVE,
    hrAttendanceStatuses.SICK_LEAVE,
    hrAttendanceStatuses.MATERNITY_LEAVE,
    hrAttendanceStatuses.PATERNITY_LEAVE,
    hrAttendanceStatuses.MIXED_LEAVE,
  ];
  const missingCheckoutExcluded = [
    hrAttendanceStatuses.ABSENT,
    hrAttendanceStatuses.HOLIDAY,
    hrAttendanceStatuses.REST_DAY,
    ...leaveStatuses,
  ];
  const [row = {}] = await AttendanceDaily.aggregate([
    { $match: { workDateKey } },
    {
      $group: {
        _id: null,
        records: { $sum: 1 },
        present: {
          $sum: {
            $cond: [
              {
                $in: [
                  "$status",
                  [hrAttendanceStatuses.PRESENT, hrAttendanceStatuses.HALF_DAY],
                ],
              },
              1,
              0,
            ],
          },
        },
        late: { $sum: { $cond: [{ $gt: ["$lateMinutes", 0] }, 1, 0] } },
        absent: {
          $sum: {
            $cond: [{ $eq: ["$status", hrAttendanceStatuses.ABSENT] }, 1, 0],
          },
        },
        onLeave: {
          $sum: { $cond: [{ $in: ["$status", leaveStatuses] }, 1, 0] },
        },
        missingCheckOuts: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$checkInAt", null] },
                  { $eq: [{ $ifNull: ["$checkOutAt", null] }, null] },
                  { $not: [{ $in: ["$status", missingCheckoutExcluded] }] },
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

async function removeById(id, { session } = {}) {
  return AttendanceDaily.findOneAndDelete({ _id: id }, { session }).lean();
}

module.exports = {
  aggregateDashboard,
  appendAdjustment,
  closeOpenById,
  createDaily,
  findById,
  findByLeaveRequestId,
  findByProfileAndWorkDate,
  findOpenByProfile,
  list,
  listByProfileIdsAndDateRange,
  listMatchingProfileIdsByDateRange,
  removeById,
  summarizeByProfileIdsAndDateRange,
  updateLeaveProjection,
  updateById,
};
