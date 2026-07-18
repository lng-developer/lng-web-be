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

async function consumeBalanceUnits(profileId, year, leaveType, units, history, { session } = {}) {
  return LeaveBalance.updateOne(
    {
      profileId,
      year,
      leaveType,
      $expr: {
        $gte: [
          { $subtract: [{ $add: ['$entitledUnits', '$adjustmentUnits'] }, '$usedUnits'] },
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

async function findOverlappingRequests(profileId, conflictKeys, { session } = {}) {
  const workingDateKeys = [...new Set(conflictKeys.map((key) => key.slice(0, 10)))];
  return LeaveRequest.find({
    profileId,
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
  const [items, total] = await Promise.all([
    LeaveRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    LeaveRequest.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function transitionRequest(requestId, expectedStatus, patch, { session } = {}) {
  return LeaveRequest.findOneAndUpdate(
    { _id: requestId, status: expectedStatus },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

module.exports = {
  consumeBalanceUnits,
  createRequest,
  findBalance,
  findOverlappingRequests,
  findRequestById,
  listBalances,
  listRequests,
  refundBalanceUnits,
  transitionRequest,
  upsertBalance,
};
