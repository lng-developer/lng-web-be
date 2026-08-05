const mongoose = require('mongoose');
const WorkScore = require('../models/workScore.model');
const { workScoreStatuses } = require('../constants/workScore.constants');
const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { buildCaseInsensitiveContainsRegex } = require('../../../shared/utils/search');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function buildMatch(query = {}) {
  const match = query.scoreStatus === 'ALL'
    ? {}
    : { status: query.scoreStatus || workScoreStatuses.ACTIVE };
  if (query.shopId) match.shopId = toObjectId(query.shopId);
  if (query.shopIds) match.shopId = { $in: query.shopIds.map(toObjectId) };
  for (const field of ['workerId', 'sourceTaskId', 'sourceType', 'scoreLevel']) {
    if (query[field]) match[field] = ['workerId', 'sourceTaskId'].includes(field) ? toObjectId(query[field]) : query[field];
  }
  if (query.taskType) match['contextSnapshot.taskType'] = query.taskType;
  const search = buildCaseInsensitiveContainsRegex(query.search);
  if (search) {
    match.$or = [
      { workerName: search },
      { 'contextSnapshot.sku': search },
      { 'contextSnapshot.title': search },
      { 'contextSnapshot.externalOrderId': search },
      { 'contextSnapshot.slotLabel': search },
    ];
  }
  if (query.dateFrom || query.dateTo) {
    match.scoredAt = {
      ...(query.dateFrom ? { $gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { $lte: endOfDay(query.dateTo) } : {}),
    };
  }
  return match;
}

async function upsertSourceScore(payload) {
  const key = {
    sourceType: payload.sourceType,
    sourceTaskId: payload.sourceTaskId,
    sourceUnitId: payload.sourceUnitId,
    assetId: payload.assetId,
  };
  try {
    return await WorkScore.findOneAndUpdate(
      key,
      { $setOnInsert: payload },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return WorkScore.findOne(key).lean();
  }
}

function findById(id) {
  return WorkScore.findOne({ _id: id }).lean();
}

function findBySourceKey(key) {
  return WorkScore.findOne(key).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const match = buildMatch(query);
  const sortBy = ['scoredAt', 'finalPoints', 'updatedAt'].includes(query.sortBy)
    ? query.sortBy
    : 'scoredAt';
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const [items, total] = await Promise.all([
    WorkScore.find(match)
      .sort({ [sortBy]: direction, _id: direction })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    WorkScore.countDocuments(match),
  ]);
  return { items, total, page, limit };
}

async function summarize(query = {}) {
  const [summary = {}] = await WorkScore.aggregate([
    { $match: buildMatch(query) },
    {
      $facet: {
        totals: [{ $group: { _id: null, totalPoints: { $sum: '$finalPoints' }, totalFiles: { $sum: 1 } } }],
        bySourceType: [{ $group: { _id: '$sourceType', totalPoints: { $sum: '$finalPoints' }, totalFiles: { $sum: 1 } } }],
        byWorker: [{ $group: { _id: '$workerId', workerName: { $first: '$workerName' }, totalPoints: { $sum: '$finalPoints' }, totalFiles: { $sum: 1 } } }],
        byTaskType: [{ $group: { _id: '$contextSnapshot.taskType', totalPoints: { $sum: '$finalPoints' }, totalFiles: { $sum: 1 } } }],
      },
    },
  ]);
  const totals = summary.totals?.[0] || {};
  return {
    totalPoints: totals.totalPoints || 0,
    totalFiles: totals.totalFiles || 0,
    bySourceType: summary.bySourceType || [],
    byWorker: summary.byWorker || [],
    byTaskType: summary.byTaskType || [],
  };
}

function adjust(id, expectedVersion, patch) {
  return WorkScore.findOneAndUpdate(
    { _id: id, __v: expectedVersion },
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { adjust, findById, findBySourceKey, list, summarize, upsertSourceScore };
