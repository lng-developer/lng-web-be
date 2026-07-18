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
  const [items, total] = await Promise.all([
    OvertimeRequest.find(filter)
      .sort({ workDateKey: -1, createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OvertimeRequest.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function transitionRequest(requestId, expectedStatus, patch) {
  return OvertimeRequest.findOneAndUpdate(
    { _id: requestId, status: expectedStatus },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  createRequest,
  findOverlappingRequests,
  findRequestById,
  listRequests,
  transitionRequest,
};
