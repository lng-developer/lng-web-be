const DesignTask = require('../models/designTask.model');
const mongoose = require('mongoose');
const {
  activeDesignTaskStatuses,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');

const SORT_FIELDS = Object.freeze(['createdAt', 'updatedAt', 'submittedAt', 'priority', 'status']);

function emptyFilter() {
  return { _id: null };
}

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.sellerRequestedByAccountId) filter.$and = [{ $or: [
    { requestedByAccountId: toObjectId(query.sellerRequestedByAccountId) },
    { listingId: { $in: (query.sellerListingIds || []).map(toObjectId) } },
  ] }];
  if (query.status) filter.status = query.status;
  if (query.salesChannelCode) filter['listingSnapshot.salesChannelCode'] = query.salesChannelCode;
  if (query.taskType) filter.taskType = query.taskType;
  if (query.priority) filter.priority = query.priority;
  if (query.psdStatus) filter['listingSnapshot.psdStatus'] = query.psdStatus;
  if (query.listingId) filter.listingId = toObjectId(query.listingId);
  if (query.listingIds) {
    if (!query.listingIds.length) return emptyFilter();
    filter.listingId = { $in: query.listingIds.map(toObjectId) };
  }
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds) {
    if (!query.shopIds.length) return emptyFilter();
    filter.shopId = { $in: query.shopIds.map(toObjectId) };
  }
  if (query.assignedDesignerId) filter.assignedDesignerId = toObjectId(query.assignedDesignerId);
  if (query.assignedDesignerIds) {
    if (!query.assignedDesignerIds.length) return emptyFilter();
    filter.assignedDesignerId = {
      $in: [
        ...query.assignedDesignerIds.map(toObjectId),
        ...(query.includeUnassignedDesigner ? [null] : []),
      ],
    };
  }
  if (query.unassigned) filter.assignedDesignerId = null;
  if (query.requestedByAccountId) filter.requestedByAccountId = toObjectId(query.requestedByAccountId);
  if (query.requestedByAccountIds) {
    if (!query.requestedByAccountIds.length) return emptyFilter();
    filter.requestedByAccountId = { $in: query.requestedByAccountIds.map(toObjectId) };
  }
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
  }
  const normalizedSearch = normalizeSearchTerm(query.search);
  const searchRegex = buildCaseInsensitivePrefixRegex(normalizedSearch);
  if (searchRegex) {
    filter.$or = [
      ...(mongoose.Types.ObjectId.isValid(normalizedSearch) ? [{ _id: toObjectId(normalizedSearch) }] : []),
      { 'listingSnapshot.asin': searchRegex },
      { 'listingSnapshot.sku': searchRegex },
      { 'listingSnapshot.title': searchRegex },
    ];
  }
  return filter;
}

function buildSort(query = {}) {
  const isAllowedSort = SORT_FIELDS.includes(query.sortBy);
  const sortBy = isAllowedSort ? query.sortBy : 'updatedAt';
  if (!isAllowedSort) return { updatedAt: -1, _id: -1 };
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  return { [sortBy]: direction, _id: direction };
}

async function create(payload) {
  const task = await DesignTask.create(payload);
  return task.toObject();
}

async function findById(taskId) {
  return DesignTask.findById(taskId).lean();
}

async function deleteById(taskId) {
  return DesignTask.findByIdAndDelete(taskId).lean();
}

async function findActiveByListingAndType(listingId, taskType) {
  return DesignTask.findOne({
    listingId,
    taskType,
    status: { $in: activeDesignTaskStatuses },
  }).lean();
}

async function findActiveByListingVariantAndType(listingVariantId, taskType) {
  return DesignTask.findOne({
    listingVariantId,
    taskType,
    status: { $in: activeDesignTaskStatuses },
  }).lean();
}

async function findActiveListingIdsByType(listingIds = [], taskType) {
  const ids = [...new Set((listingIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const tasks = await DesignTask.find({
    listingId: { $in: ids.map(toObjectId) },
    taskType,
    status: { $in: activeDesignTaskStatuses },
  }).select('listingId').lean();
  return [...new Set((tasks || []).map((task) => String(task.listingId)).filter(Boolean))];
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    DesignTask.find(filter)
      .sort(buildSort(query))
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
              requested: countStatus(designTaskStatuses.REQUESTED),
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
      requestedCount: byStatus[designTaskStatuses.REQUESTED] || 0,
      submittedCount: byStatus[designTaskStatuses.SUBMITTED] || 0,
      approvedCount: byStatus[designTaskStatuses.APPROVED] || 0,
      rejectedCount: byStatus[designTaskStatuses.REJECTED] || 0,
    },
    byDesigner: (result.byDesigner || []).map((row) => ({
      assignedDesignerId: row._id === null || row._id === undefined ? null : String(row._id),
      requested: row.requested || 0,
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

async function countActiveByDesigner(query = {}) {
  const { status, assignedDesignerId, unassigned, ...filterQuery } = query;
  const filter = {
    ...buildFilter(filterQuery),
    status: { $in: activeDesignTaskStatuses },
    assignedDesignerId: { $ne: null },
  };
  const rows = await DesignTask.aggregate([
    { $match: filter },
    { $group: { _id: '$assignedDesignerId', activeTaskCount: { $sum: 1 } } },
  ]);
  return (rows || []).map((row) => ({
    assignedDesignerId: row._id === null || row._id === undefined ? null : String(row._id),
    activeTaskCount: row.activeTaskCount || 0,
  }));
}

async function listPsdFileLinks(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const taskMatch = {
    ...(query.sellerRequestedByAccountId ? { $and: buildFilter(query).$and } : {}),
    taskType: designTaskTypes.PSD_TEMPLATE,
    ...(query.shopId ? { shopId: toObjectId(query.shopId) } : {}),
    ...(query.shopIds ? { shopId: { $in: query.shopIds.map(toObjectId) } } : {}),
    ...(query.assignedDesignerId
      ? { assignedDesignerId: toObjectId(query.assignedDesignerId) }
      : {}),
    ...(query.assignedDesignerIds
      ? { assignedDesignerId: { $in: query.assignedDesignerIds.map(toObjectId) } }
      : {}),
    ...(query.taskStatus ? { status: query.taskStatus } : {}),
  };
  const normalizedSearch = normalizeSearchTerm(query.search);
  const searchRegex = buildCaseInsensitivePrefixRegex(normalizedSearch);
  const basePipeline = [
    { $match: taskMatch },
    {
      $project: {
        taskType: 1,
        status: 1,
        listingId: 1,
        listingSnapshot: 1,
        assignedDesignerId: 1,
        createdAt: 1,
        fileLinks: {
          $concatArrays: [
            {
              $map: {
                input: '$referenceAssetIds',
                as: 'assetId',
                in: {
                  assetId: '$$assetId',
                  role: 'REFERENCE',
                  submissionId: null,
                  version: null,
                  linkedAt: '$createdAt',
                },
              },
            },
            {
              $reduce: {
                input: '$submissions',
                initialValue: [],
                in: {
                  $concatArrays: [
                    '$$value',
                    {
                      $map: {
                        input: '$$this.assetIds',
                        as: 'assetId',
                        in: {
                          assetId: '$$assetId',
                          role: 'SUBMISSION',
                          submissionId: '$$this._id',
                          version: '$$this.version',
                          linkedAt: '$$this.submittedAt',
                        },
                      },
                    },
                    {
                      $cond: [
                        { $ne: ['$$this.approvedAssetId', null] },
                        [{
                          assetId: '$$this.approvedAssetId',
                          role: 'APPROVED',
                          submissionId: '$$this._id',
                          version: '$$this.version',
                          linkedAt: '$$this.approvedAt',
                        }],
                        [],
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
    { $unwind: '$fileLinks' },
    ...(query.dateFrom || query.dateTo
      ? [{
          $match: {
            'fileLinks.linkedAt': {
              ...(query.dateFrom ? { $gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { $lte: endOfDay(query.dateTo) } : {}),
            },
          },
        }]
      : []),
    ...(query.role ? [{ $match: { 'fileLinks.role': query.role } }] : []),
    ...(searchRegex
      ? [{
          $match: {
            $or: [
              ...(mongoose.Types.ObjectId.isValid(normalizedSearch)
                ? [{ _id: toObjectId(normalizedSearch) }]
                : []),
              { 'fileLinks.assetId': { $in: (query.matchingAssetIds || []).map(toObjectId) } },
              { 'listingSnapshot.sku': searchRegex },
              { 'listingSnapshot.asin': searchRegex },
              { 'listingSnapshot.title': searchRegex },
            ],
          },
        }]
      : []),
    {
      $set: {
        linkIdentity: {
          $concat: [
            { $toString: '$fileLinks.assetId' },
            ':',
            '$fileLinks.role',
            ':',
            { $ifNull: [{ $toString: '$fileLinks.submissionId' }, 'task'] },
          ],
        },
      },
    },
  ];
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const [result = {}] = await DesignTask.aggregate([
    ...basePipeline,
    {
      $facet: {
        items: [
          { $sort: { 'fileLinks.linkedAt': direction, _id: direction, linkIdentity: direction } },
          { $skip: getPaginationOffset({ page, limit }) },
          { $limit: limit },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  return {
    items: result.items || [],
    total: result.total?.[0]?.count || 0,
    page,
    limit,
  };
}

async function updateById(taskId, patch, expected = {}) {
  return DesignTask.findOneAndUpdate(
    { ...expected, _id: taskId },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

function listApprovedForWorkScore(limit) {
  return DesignTask.find({ status: designTaskStatuses.APPROVED, approvedAssetId: { $ne: null } })
    .sort({ _id: 1 }).limit(limit).lean();
}

function findTaskReferencingAsset(assetId, query) {
  const filter = buildFilter(query);
  return DesignTask.findOne({ ...filter, $and: [...(filter.$and || []), { $or: [
    { referenceAssetIds: toObjectId(assetId) }, { submittedAssetIds: toObjectId(assetId) },
    { approvedAssetId: toObjectId(assetId) }, { 'submissions.assetIds': toObjectId(assetId) },
    { 'submissions.approvedAssetId': toObjectId(assetId) },
  ] }] }).select('_id').lean();
}

module.exports = {
  findTaskReferencingAsset,
  buildFilter,
  buildSort,
  countActiveByDesigner,
  create,
  deleteById,
  findActiveByListingAndType,
  findActiveByListingVariantAndType,
  findActiveListingIdsByType,
  findById,
  getWorkload,
  list,
  listApprovedForWorkScore,
  listPsdFileLinks,
  updateById,
};
