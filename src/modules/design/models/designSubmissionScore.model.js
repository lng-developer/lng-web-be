const mongoose = require('mongoose');
const { designScoreLevels, designScoreStatuses } = require('../constants/design.constants');

const { Schema } = mongoose;

const designSubmissionScoreSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'DesignTask', required: true, index: true },
  submissionId: { type: Schema.Types.ObjectId, required: true, index: true },
  taskType: { type: String, required: true, index: true },
  submissionVersion: { type: Number, required: true, min: 1 },
  designerId: { type: Schema.Types.ObjectId, required: true, index: true },
  designerName: { type: String, trim: true, default: null },
  teamId: { type: Schema.Types.ObjectId, default: null, index: true },
  teamName: { type: String, trim: true, default: null },
  departmentId: { type: Schema.Types.ObjectId, default: null, index: true },
  departmentName: { type: String, trim: true, default: null },
  basePoints: { type: Number, required: true, min: 0 },
  finalPoints: { type: Number, required: true, min: 0 },
  scoreLevel: { type: String, enum: Object.values(designScoreLevels), required: true },
  status: {
    type: String,
    enum: Object.values(designScoreStatuses),
    required: true,
    default: designScoreStatuses.ACTIVE,
    index: true,
  },
  ruleSnapshot: { type: Schema.Types.Mixed, default: null },
  override: {
    points: { type: Number, min: 0, default: null },
    reason: { type: String, trim: true, default: null },
    overriddenBy: { type: Schema.Types.ObjectId, default: null },
    overriddenAt: { type: Date, default: null },
  },
  scoredBy: { type: Schema.Types.ObjectId, default: null },
  scoredAt: { type: Date, default: Date.now, index: true },
  voidedBy: { type: Schema.Types.ObjectId, default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, trim: true, default: null },
}, { timestamps: true });

designSubmissionScoreSchema.index({ taskId: 1, submissionId: 1 }, { unique: true });
designSubmissionScoreSchema.index({ status: 1, scoredAt: -1 });
designSubmissionScoreSchema.index({ designerId: 1, status: 1, scoredAt: -1 });
designSubmissionScoreSchema.index({ teamId: 1, status: 1, scoredAt: -1 });
designSubmissionScoreSchema.index({ departmentId: 1, status: 1, scoredAt: -1 });

module.exports = mongoose.model('DesignSubmissionScore', designSubmissionScoreSchema);
