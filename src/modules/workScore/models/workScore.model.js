const mongoose = require('mongoose');
const {
  workScoreAdjustmentTypes,
  workScoreLevels,
  workScoreSourceTypes,
  workScoreStatuses,
} = require('../constants/workScore.constants');

const { Schema } = mongoose;

const adjustmentSchema = new Schema({
  type: { type: String, enum: Object.values(workScoreAdjustmentTypes), required: true },
  oldPoints: { type: Number, min: 0, required: true },
  newPoints: { type: Number, min: 0, required: true },
  oldScoreLevel: { type: String, enum: Object.values(workScoreLevels), required: true },
  newScoreLevel: { type: String, enum: Object.values(workScoreLevels), required: true },
  oldStatus: { type: String, enum: Object.values(workScoreStatuses), required: true },
  newStatus: { type: String, enum: Object.values(workScoreStatuses), required: true },
  actorId: { type: Schema.Types.ObjectId, default: null },
  reason: { type: String, trim: true, required: true },
  adjustedAt: { type: Date, default: Date.now, required: true },
}, { _id: false });

const workScoreSchema = new Schema({
  sourceType: { type: String, enum: Object.values(workScoreSourceTypes), required: true, index: true },
  sourceTaskId: { type: Schema.Types.ObjectId, required: true, index: true },
  sourceUnitId: { type: Schema.Types.ObjectId, required: true, index: true },
  assetId: { type: Schema.Types.ObjectId, ref: 'MediaAsset', required: true, index: true },
  shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  workerId: { type: Schema.Types.ObjectId, required: true, index: true },
  workerName: { type: String, trim: true, default: null },
  teamId: { type: Schema.Types.ObjectId, default: null, index: true },
  teamName: { type: String, trim: true, default: null },
  departmentId: { type: Schema.Types.ObjectId, default: null, index: true },
  departmentName: { type: String, trim: true, default: null },
  contextSnapshot: { type: Schema.Types.Mixed, default: null },
  basePoints: { type: Number, required: true, min: 0 },
  finalPoints: { type: Number, required: true, min: 0 },
  scoreLevel: { type: String, enum: Object.values(workScoreLevels), required: true },
  status: { type: String, enum: Object.values(workScoreStatuses), default: workScoreStatuses.ACTIVE, index: true },
  ruleSnapshot: { type: Schema.Types.Mixed, default: null },
  scoredBy: { type: Schema.Types.ObjectId, default: null },
  scoredAt: { type: Date, default: Date.now, index: true },
  adjustments: { type: [adjustmentSchema], default: [] },
}, { timestamps: true });

workScoreSchema.index(
  { sourceType: 1, sourceTaskId: 1, sourceUnitId: 1, assetId: 1 },
  { unique: true },
);
workScoreSchema.index({ shopId: 1, status: 1, scoredAt: -1 });
workScoreSchema.index({ workerId: 1, status: 1, scoredAt: -1 });

module.exports = mongoose.model('WorkScore', workScoreSchema);
