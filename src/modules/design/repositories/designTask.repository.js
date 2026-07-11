const DesignTask = require('../models/designTask.model');
const mongoose = require('mongoose');
const { activeDesignTaskStatuses, designTaskStatuses } = require('../constants/design.constants');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

function emptyFilter() {
  return { _id: null };
}

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.taskType) filter.taskType = query.taskType;
  if (query.listingId) filter.listingId = toObjectId(query.listingId);
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds) {
    if (!query.shopIds.length) return emptyFilter();
    filter.shopId = { $in: query.shopIds.map(toObjectId) };
  }
  if (query.assignedDesignerId) filter.assignedDesignerId = toObjectId(query.assignedDesignerId);
  if (query.unassigned) filter.assignedDesignerId = null;
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
  }
  return filter;
}

async function create(payload) {
  const task = await DesignTask.create(payload);
  return task.toObject();
}

async function findById(taskId) {
  return DesignTask.findById(taskId).lean();
}

async function findActiveByListingAndType(listingId, taskType) {
  return DesignTask.findOne({
    listingId,
    taskType,
    status: { $in: activeDesignTaskStatuses },
  }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    DesignTask.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    DesignTask.countDocuments(filter),
  ]);
  return toPaginatedResult({
    items, total, page, limit,
  });
}

function countStatus(status) {
  return { $sum: { $cond: [{ $eq: ['$status', status] }, 1, 0] } };
}

async function getWorkload(query = {}) {
  const filter = buildFilter(query);
  const [result = {}] = await DesignTask.aggregate([
    { $match: filter },
    {
      $facet: {
        statusCounts: [
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ],
        taskTypeCounts: [
          { $group: { _id: '$taskType', count: { $sum: 1 } } },
        ],
        byDesigner: [
          { $match: { assignedDesignerId: { $ne: null } } },
          {
            $group: {
              _id: '$assignedDesignerId',
              open: countStatus(designTaskStatuses.OPEN),
              inProgress: countStatus(designTaskStatuses.IN_PROGRESS),
              submitted: countStatus(designTaskStatuses.SUBMITTED),
              approved: countStatus(designTaskStatuses.APPROVED),
              rejected: countStatus(designTaskStatuses.REJECTED),
              totalActive: {
                $sum: {
                  $cond: [{ $in: ['$status', activeDesignTaskStatuses] }, 1, 0],
                },
              },
              oldestActiveTaskAt: {
                $min: {
                  $cond: [{ $in: ['$status', activeDesignTaskStatuses] }, '$createdAt', null],
                },
              },
            },
          },
          { $sort: { totalActive: -1, _id: 1 } },
        ],
        unassigned: [
          { $match: { assignedDesignerId: null } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  const byStatus = Object.fromEntries((result.statusCounts || []).map((row) => [row._id, row.count]));
  const byTaskType = Object.fromEntries((result.taskTypeCounts || []).map((row) => [row._id, row.count]));
  const unassignedCount = result.unassigned?.[0]?.count || 0;

  return {
    totals: {
      byStatus,
      byTaskType,
      unassignedCount,
      activeCount: activeDesignTaskStatuses.reduce((sum, status) => sum + (byStatus[status] || 0), 0),
      submittedCount: byStatus[designTaskStatuses.SUBMITTED] || 0,
      approvedCount: byStatus[designTaskStatuses.APPROVED] || 0,
      rejectedCount: byStatus[designTaskStatuses.REJECTED] || 0,
    },
    byDesigner: (result.byDesigner || []).map((row) => ({
      assignedDesignerId: row._id === null || row._id === undefined ? null : String(row._id),
      open: row.open || 0,
      inProgress: row.inProgress || 0,
      submitted: row.submitted || 0,
      approved: row.approved || 0,
      rejected: row.rejected || 0,
      totalActive: row.totalActive || 0,
      oldestActiveTaskAt: row.oldestActiveTaskAt || null,
    })),
  };
}

async function updateById(taskId, patch) {
  return DesignTask.findByIdAndUpdate(
    taskId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  buildFilter,
  create,
  findActiveByListingAndType,
  findById,
  getWorkload,
  list,
  updateById,
};
