const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { hrRequestStatuses } = require('../constants/hr.constants');
const OvertimeRequest = require('../models/overtimeRequest.model');

async function createRequest(payload) {
  return (await OvertimeRequest.create(payload)).toObject();
}

async function findRequestById(requestId) {
  return OvertimeRequest.findById(requestId).lean();
}

async function findOverlappingRequests(profileId, plannedStartAt, plannedEndAt, { excludeRequestId } = {}) {
  return OvertimeRequest.find({
    profileId,
    ...(excludeRequestId ? { _id: { $ne: excludeRequestId } } : {}),
    status: { $in: [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED] },
    plannedStartAt: { $lt: plannedEndAt },
    plannedEndAt: { $gt: plannedStartAt },
  }).lean();
}

async function updatePendingRequest(requestId, accountId, patch) {
  return OvertimeRequest.findOneAndUpdate(
    { _id: requestId, accountId, status: hrRequestStatuses.PENDING },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

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

async function listRequests(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildFilter(query);
  const statuses = Object.values(hrRequestStatuses);
  const [items, total, ...statusTotals] = await Promise.all([
    OvertimeRequest.find(filter)
      .sort({ workDateKey: -1, createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OvertimeRequest.countDocuments(filter),
    ...statuses.map((status) => OvertimeRequest.countDocuments({ $and: [filter, { status }] })),
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

async function countApprovedByProfileIdsAndDateRange(profileIds, dateFrom, dateTo) {
  if (!profileIds.length) return 0;
  return OvertimeRequest.countDocuments({
    profileId: { $in: profileIds },
    status: hrRequestStatuses.APPROVED,
    workDateKey: { $gte: dateFrom, $lte: dateTo },
  });
}

async function transitionRequest(requestId, expectedStatus, patch, { expectedApprovalLevel } = {}) {
  return OvertimeRequest.findOneAndUpdate(
    { _id: requestId, status: expectedStatus, ...(expectedApprovalLevel ? { currentApprovalLevel: expectedApprovalLevel } : {}) },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function aggregateDashboard(workDateKey) {
  const [row = {}] = await OvertimeRequest.aggregate([
    {
      $match: {
        $or: [
          { status: hrRequestStatuses.PENDING },
          { status: hrRequestStatuses.APPROVED, workDateKey },
        ],
      },
    },
    {
      $group: {
        _id: null,
        pending: { $sum: { $cond: [{ $eq: ['$status', hrRequestStatuses.PENDING] }, 1, 0] } },
        approvedToday: {
          $sum: {
            $cond: [{
              $and: [
                { $eq: ['$status', hrRequestStatuses.APPROVED] },
                { $eq: ['$workDateKey', workDateKey] },
              ],
            }, 1, 0],
          },
        },
      },
    },
  ]);
  return row;
}

module.exports = {
  aggregateDashboard,
  createRequest,
  countApprovedByProfileIdsAndDateRange,
  findOverlappingRequests,
  findRequestById,
  listRequests,
  transitionRequest,
  updatePendingRequest,
};
