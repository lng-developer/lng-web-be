const DesignTask = require('../models/designTask.model');
const { activeDesignTaskStatuses } = require('../constants/design.constants');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');

function buildFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.taskType) filter.taskType = query.taskType;
  if (query.listingId) filter.listingId = query.listingId;
  if (query.shopId) filter.shopId = query.shopId;
  if (query.assignedDesignerId) filter.assignedDesignerId = query.assignedDesignerId;
  if (query.unassigned) filter.assignedDesignerId = null;
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
  list,
  updateById,
};
