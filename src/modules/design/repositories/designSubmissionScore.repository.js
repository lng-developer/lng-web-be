const mongoose = require('mongoose');
const DesignSubmissionScore = require('../models/designSubmissionScore.model');
const { designScoreStatuses } = require('../constants/design.constants');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function buildMatch(query = {}) {
  const match = { status: query.status || designScoreStatuses.ACTIVE };
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
  return DesignSubmissionScore.findOneAndUpdate(
    { taskId: payload.taskId, submissionId: payload.submissionId },
    { $setOnInsert: payload },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  ).lean();
}

async function findBySubmissionIds(submissionIds = []) {
  if (!submissionIds.length) return [];
  return DesignSubmissionScore.find({ submissionId: { $in: submissionIds.map(toObjectId) } }).lean();
}

async function overrideScore(scoreId, patch) {
  return DesignSubmissionScore.findByIdAndUpdate(
    scoreId,
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

module.exports = {
  findBySubmissionIds,
  overrideScore,
  summarize,
  upsertAutoScore,
  voidByTaskSubmission,
};
