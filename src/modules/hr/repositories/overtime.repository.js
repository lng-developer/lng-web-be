const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { hrRequestStatuses } = require('../constants/hr.constants');
const OvertimeRequest = require('../models/overtimeRequest.model');

async function createRequest(payload) {
  return (await OvertimeRequest.create(payload)).toObject();
}

async function findRequestById(requestId) {
  return OvertimeRequest.findById(requestId).lean();
}

async function findOverlappingRequests(profileId, plannedStartAt, plannedEndAt) {
  return OvertimeRequest.find({
    profileId,
    status: { $in: [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED] },
    plannedStartAt: { $lt: plannedEndAt },
    plannedEndAt: { $gt: plannedStartAt },
  }).lean();
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
  findOverlappingRequests,
  findRequestById,
  listRequests,
  transitionRequest,
};
