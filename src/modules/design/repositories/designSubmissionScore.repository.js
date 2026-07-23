const mongoose = require('mongoose');
const DesignSubmissionScore = require('../models/designSubmissionScore.model');
const { designScoreStatuses, designTaskTypes } = require('../constants/design.constants');
const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const {
  buildCaseInsensitivePrefixRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function buildMatch(query = {}) {
  const match = { status: designScoreStatuses.ACTIVE };
  for (const field of ['designerId', 'teamId', 'departmentId']) {
    if (query[field]) match[field] = toObjectId(query[field]);
  }
  if (query.taskType) match.taskType = query.taskType;
  if (query.dateFrom || query.dateTo) {
    match.scoredAt = {};
    if (query.dateFrom) match.scoredAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) match.scoredAt.$lte = endOfDay(query.dateTo);
  }
  return match;
}

async function upsertAutoScore(payload) {
  try {
    return await DesignSubmissionScore.findOneAndUpdate(
      { taskId: payload.taskId, submissionId: payload.submissionId },
      { $setOnInsert: payload },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return DesignSubmissionScore.findOne({ taskId: payload.taskId, submissionId: payload.submissionId }).lean();
  }
}

async function findBySubmissionIds(submissionIds = []) {
  if (!submissionIds.length) return [];
  return DesignSubmissionScore.find({ submissionId: { $in: submissionIds.map(toObjectId) } }).lean();
}

async function findActiveById(scoreId) {
  return DesignSubmissionScore.findOne({ _id: scoreId, status: designScoreStatuses.ACTIVE }).lean();
}

async function findActiveByTaskSubmission(taskId, submissionId) {
  return DesignSubmissionScore.findOne({
    taskId,
    submissionId,
    status: designScoreStatuses.ACTIVE,
  }).lean();
}

async function overrideScore(scoreId, patch) {
  return DesignSubmissionScore.findOneAndUpdate(
    { _id: scoreId, status: designScoreStatuses.ACTIVE },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function voidByTaskSubmission(taskId, submissionId, patch) {
  return DesignSubmissionScore.findOneAndUpdate(
    { taskId, submissionId, status: designScoreStatuses.ACTIVE },
    { $set: { ...patch, status: designScoreStatuses.VOIDED } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function summarize(query = {}) {
  const [summary = {}] = await DesignSubmissionScore.aggregate([
    { $match: buildMatch(query) },
    {
      $facet: {
        totals: [{
          $group: {
            _id: null,
            totalPoints: { $sum: '$finalPoints' },
            totalFiles: { $sum: 1 },
          },
        }],
        byDesigner: [{
          $group: {
            _id: '$designerId',
            designerId: { $first: '$designerId' },
            designerName: { $first: '$designerName' },
            teamId: { $first: '$teamId' },
            teamName: { $first: '$teamName' },
            departmentId: { $first: '$departmentId' },
            departmentName: { $first: '$departmentName' },
            totalPoints: { $sum: '$finalPoints' },
            totalFiles: { $sum: 1 },
          },
        }, { $sort: { totalPoints: -1, designerName: 1 } }],
        byTaskType: [{
          $group: {
            _id: '$taskType',
            taskType: { $first: '$taskType' },
            totalPoints: { $sum: '$finalPoints' },
            totalFiles: { $sum: 1 },
          },
        }, { $sort: { taskType: 1 } }],
      },
    },
  ]);

  const totals = summary.totals?.[0] || {};
  return {
    totalPoints: totals.totalPoints || 0,
    totalFiles: totals.totalFiles || 0,
    byDesigner: summary.byDesigner || [],
    byTaskType: summary.byTaskType || [],
  };
}

async function listPsdScoreRows(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const scoreMatch = {
    taskType: designTaskTypes.PSD_TEMPLATE,
    ...(query.scoreStatus !== 'ALL'
      ? { status: query.scoreStatus || designScoreStatuses.ACTIVE }
      : {}),
    ...(query.designerId ? { designerId: toObjectId(query.designerId) } : {}),
    ...(query.scoreLevel ? { scoreLevel: query.scoreLevel } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          scoredAt: {
            ...(query.dateFrom ? { $gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { $lte: endOfDay(query.dateTo) } : {}),
          },
        }
      : {}),
  };
  const taskMatch = {
    'task.taskType': designTaskTypes.PSD_TEMPLATE,
    ...(query.shopId ? { 'task.shopId': toObjectId(query.shopId) } : {}),
    ...(query.shopIds ? { 'task.shopId': { $in: query.shopIds.map(toObjectId) } } : {}),
    ...(query.assignedDesignerId
      ? { 'task.assignedDesignerId': toObjectId(query.assignedDesignerId) }
      : {}),
  };
  const normalizedSearch = normalizeSearchTerm(query.search);
  const searchRegex = buildCaseInsensitivePrefixRegex(normalizedSearch);
  const basePipeline = [
    { $match: scoreMatch },
    {
      $lookup: {
        from: 'designtasks',
        localField: 'taskId',
        foreignField: '_id',
        as: 'task',
      },
    },
    { $unwind: '$task' },
    { $match: taskMatch },
    {
      $set: {
        submission: {
          $first: {
            $filter: {
              input: '$task.submissions',
              as: 'submission',
              cond: { $eq: ['$$submission._id', '$submissionId'] },
            },
          },
        },
      },
    },
    {
      $set: {
        assetId: {
          $ifNull: ['$submission.approvedAssetId', { $arrayElemAt: ['$submission.assetIds', 0] }],
        },
      },
    },
    ...(searchRegex
      ? [{
          $match: {
            $or: [
              ...(mongoose.Types.ObjectId.isValid(normalizedSearch)
                ? [{ 'task._id': toObjectId(normalizedSearch) }]
                : []),
              { assetId: { $in: (query.matchingAssetIds || []).map(toObjectId) } },
              { 'task.listingSnapshot.sku': searchRegex },
              { 'task.listingSnapshot.asin': searchRegex },
              { 'task.listingSnapshot.title': searchRegex },
            ],
          },
        }]
      : []),
  ];
  const sortBy = ['scoredAt', 'finalPoints', 'updatedAt'].includes(query.sortBy)
    ? query.sortBy
    : 'scoredAt';
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const [result = {}] = await DesignSubmissionScore.aggregate([
    ...basePipeline,
    {
      $facet: {
        items: [
          { $sort: { [sortBy]: direction, _id: direction } },
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

module.exports = {
  findActiveById,
  findActiveByTaskSubmission,
  findBySubmissionIds,
  listPsdScoreRows,
  overrideScore,
  summarize,
  upsertAutoScore,
  voidByTaskSubmission,
};
