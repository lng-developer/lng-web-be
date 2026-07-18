const mongoose = require('mongoose');
const { hrLeaveTypes } = require('../constants/hr.constants');

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

const historySchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  actorName: { type: String, default: null, trim: true },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrLeaveRequest', default: null },
  action: { type: String, enum: ['SET', 'CONSUME', 'REFUND'], required: true },
  units: { type: Number, validate: integer, min: 0, required: true },
  entitledUnits: { type: Number, validate: integer, min: 0, default: null },
  adjustmentUnits: { type: Number, validate: integer, default: null },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  occurredAt: { type: Date, required: true },
}, { _id: false });

const leaveBalanceSchema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true },
  year: { type: Number, validate: integer, min: 2000, max: 2100, required: true },
  leaveType: { type: String, enum: Object.values(hrLeaveTypes), required: true },
  entitledUnits: { type: Number, validate: integer, min: 0, default: 0 },
  adjustmentUnits: { type: Number, validate: integer, default: 0 },
  usedUnits: { type: Number, validate: integer, min: 0, default: 0 },
  history: { type: [historySchema], default: [] },
}, { timestamps: true, versionKey: false });

leaveBalanceSchema.index({ profileId: 1, year: 1, leaveType: 1 }, { unique: true });

module.exports = mongoose.models.HrLeaveBalance
  || mongoose.model('HrLeaveBalance', leaveBalanceSchema);
