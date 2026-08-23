const WorkScoreRule = require('../models/workScoreRule.model');

const sort = { sourceType: 1, taskType: 1, priority: 1, scaleDifficultyLevel: 1 };

const list = () => WorkScoreRule.find({}).sort(sort).lean();
const findActive = (query) => WorkScoreRule.findOne({ ...query, status: 'ACTIVE' }).lean();
const upsert = (payload) => WorkScoreRule.findOneAndUpdate(
  {
    sourceType: payload.sourceType,
    taskType: payload.taskType || null,
    priority: payload.priority || null,
    scaleDifficultyLevel: payload.scaleDifficultyLevel || null,
  },
  { $set: payload },
  { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
).lean();

module.exports = { findActive, list, upsert };
