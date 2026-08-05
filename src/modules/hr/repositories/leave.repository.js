const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { hrRequestStatuses } = require('../constants/hr.constants');
const LeaveBalance = require('../models/leaveBalance.model');
const LeaveRequest = require('../models/leaveRequest.model');

async function findBalance(profileId, year, leaveType, { session } = {}) {
  return LeaveBalance.findOne({ profileId, year, leaveType }).session(session || null).lean();
}

async function listBalances({ profileId, year }) {
  return LeaveBalance.find({ profileId, year }).sort({ leaveType: 1 }).lean();
}

async function upsertBalance(profileId, year, leaveType, values, history, { session } = {}) {
  return LeaveBalance.findOneAndUpdate(
    { profileId, year, leaveType },
    {
      $set: values,
      $setOnInsert: { usedUnits: 0 },
      $push: { history },
    },
    { upsert: true, returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function ensureBalance(profileId, year, leaveType, { session } = {}) {
  return LeaveBalance.findOneAndUpdate(
    { profileId, year, leaveType },
    { $setOnInsert: { entitledUnits: 0, carriedOverUnits: 0, adjustmentUnits: 0, usedUnits: 0 } },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true, session },
  ).lean();
}

async function adjustBalance(profileId, year, leaveType, units, history, { session } = {}) {
  return LeaveBalance.findOneAndUpdate(
    {
      profileId,
      year,
      leaveType,
      $expr: {
        $gte: [
          {
            $add: [
              { $subtract: [{ $add: ['$entitledUnits', { $ifNull: ['$carriedOverUnits', 0] }, '$adjustmentUnits'] }, '$usedUnits'] },
              units,
            ],
          },
          0,
        ],
      },
    },
    { $inc: { adjustmentUnits: units }, $push: { history } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function accrueBalance(profileId, year, leaveType, month, units, history, { session } = {}) {
  return LeaveBalance.findOneAndUpdate(
    {
      profileId,
      year,
      leaveType,
      $or: [{ lastAccruedMonth: { $lt: month } }, { lastAccruedMonth: { $exists: false } }],
    },
    { $inc: { entitledUnits: units }, $set: { lastAccruedMonth: month }, $push: { history } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function resetBalance(profileId, year, leaveType, entitledUnits, history, { session } = {}) {
  return LeaveBalance.findOneAndUpdate(
    { profileId, year, leaveType },
    {
      $set: { entitledUnits, carriedOverUnits: 0, adjustmentUnits: 0, usedUnits: 0, lastAccruedMonth: 0 },
      $push: { history },
    },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true, session },
  ).lean();
}

async function setCarryOver(profileId, year, leaveType, carriedOverUnits, history, { session } = {}) {
  return LeaveBalance.findOneAndUpdate(
    { profileId, year, leaveType },
    { $set: { carriedOverUnits }, $push: { history } },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true, session },
  ).lean();
}

async function consumeBalanceUnits(profileId, year, leaveType, units, history, { session } = {}) {
  return LeaveBalance.updateOne(
    {
      profileId,
      year,
      leaveType,
      $expr: {
        $gte: [
          { $subtract: [{ $add: ['$entitledUnits', { $ifNull: ['$carriedOverUnits', 0] }, '$adjustmentUnits'] }, '$usedUnits'] },
          units,
        ],
      },
    },
    { $inc: { usedUnits: units }, $push: { history } },
    { runValidators: true, session },
  );
}

async function refundBalanceUnits(profileId, year, leaveType, units, history, { session } = {}) {
  return LeaveBalance.updateOne(
    { profileId, year, leaveType, usedUnits: { $gte: units } },
    { $inc: { usedUnits: -units }, $push: { history } },
    { runValidators: true, session },
  );
}

async function createRequest(payload, { session } = {}) {
  const [request] = await LeaveRequest.create([payload], { session });
  return request.toObject();
}

async function findRequestById(requestId, { session } = {}) {
  return LeaveRequest.findById(requestId).session(session || null).lean();
}

async function findOverlappingRequests(profileId, conflictKeys, { excludeRequestId, session } = {}) {
  const workingDateKeys = [...new Set(conflictKeys.map((key) => key.slice(0, 10)))];
  return LeaveRequest.find({
    profileId,
    ...(excludeRequestId ? { _id: { $ne: excludeRequestId } } : {}),
    status: { $in: [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED] },
    $or: [
      { conflictKeys: { $in: conflictKeys } },
      {
        conflictKeys: { $exists: false },
        workingDateKeys: { $in: workingDateKeys },
      },
      {
        conflictKeys: { $size: 0 },
        workingDateKeys: { $in: workingDateKeys },
      },
    ],
  }).session(session || null).lean();
}

async function updatePendingRequest(requestId, accountId, patch) {
  return LeaveRequest.findOneAndUpdate(
    { _id: requestId, accountId, status: hrRequestStatuses.PENDING },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

function buildRequestFilter({
  dateFrom,
  dateTo,
  leaveType,
  profileId,
  scopeFilters,
  status,
  year,
} = {}) {
  const filter = {};
  if (profileId) filter.profileId = profileId;
  if (leaveType) filter.leaveType = leaveType;
  if (status) filter.status = status;
  if (year) filter.year = year;
  if (dateFrom) filter.endDateKey = { $gte: dateFrom };
  if (dateTo) filter.startDateKey = { $lte: dateTo };
  if (scopeFilters?.length) filter.$or = scopeFilters;
  return filter;
}

async function listRequests(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildRequestFilter(query);
  const statuses = Object.values(hrRequestStatuses);
  const [items, total, ...statusTotals] = await Promise.all([
    LeaveRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    LeaveRequest.countDocuments(filter),
    ...statuses.map((status) => LeaveRequest.countDocuments({ $and: [filter, { status }] })),
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

async function transitionRequest(requestId, expectedStatus, patch, { expectedApprovalLevel, session } = {}) {
  return LeaveRequest.findOneAndUpdate(
    { _id: requestId, status: expectedStatus, ...(expectedApprovalLevel ? { currentApprovalLevel: expectedApprovalLevel } : {}) },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function countPendingRequests() {
  return LeaveRequest.countDocuments({ status: hrRequestStatuses.PENDING });
}

async function appendAttachments(requestId, accountId, attachments, { session } = {}) {
  const mediaIds = attachments.map(({ mediaId }) => String(mediaId));
  return LeaveRequest.findOneAndUpdate(
    {
      _id: requestId,
      accountId,
      status: hrRequestStatuses.PENDING,
      'attachments.mediaId': { $nin: mediaIds },
    },
    { $push: { attachments: { $each: attachments } } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

module.exports = {
  accrueBalance,
  adjustBalance,
  appendAttachments,
  consumeBalanceUnits,
  countPendingRequests,
  createRequest,
  ensureBalance,
  findBalance,
  findOverlappingRequests,
  findRequestById,
  listBalances,
  listRequests,
  refundBalanceUnits,
  resetBalance,
  setCarryOver,
  transitionRequest,
  updatePendingRequest,
  upsertBalance,
};
