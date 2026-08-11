const mongoose = require('mongoose');
const { workScoreRuleStatuses, workScoreSourceTypes } = require('../constants/workScore.constants');

const workScoreRuleSchema = new mongoose.Schema({
  sourceType: { type: String, enum: Object.values(workScoreSourceTypes), required: true, index: true },
  taskType: { type: String, trim: true, uppercase: true, default: null, index: true },
  priority: { type: String, trim: true, uppercase: true, default: null, index: true },
  slotKey: { type: String, trim: true, uppercase: true, default: null, index: true },
  scaleDifficultyLevel: { type: String, enum: ['NORMAL', 'HARD', 'SPECIAL'], default: null, index: true },
  points: { type: Number, min: 0, required: true },
  status: { type: String, enum: Object.values(workScoreRuleStatuses), default: workScoreRuleStatuses.ACTIVE, index: true },
}, { timestamps: true });

workScoreRuleSchema.index(
  { sourceType: 1, taskType: 1, priority: 1, slotKey: 1, scaleDifficultyLevel: 1 },
  { unique: true },
);

module.exports = mongoose.model('WorkScoreRule', workScoreRuleSchema);
