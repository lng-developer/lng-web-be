const mongoose = require('mongoose');
const { hrRequestStatuses } = require('../constants/hr.constants');

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

const actorSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  actorName: { type: String, default: null, trim: true },
  reason: { type: String, default: null, trim: true, maxlength: 500 },
  occurredAt: { type: Date, required: true },
}, { _id: false });

const requesterSnapshotSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true },
  employeeCode: { type: String, default: null, trim: true },
  fullName: { type: String, required: true, trim: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
}, { _id: false });

const scheduleSnapshotSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrShiftAssignment', default: null },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  timezone: { type: String, required: true, trim: true },
  calendarStatus: { type: String, required: true, trim: true },
  workLocation: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'HrWorkLocation', required: true },
    code: { type: String, default: null, trim: true },
    name: { type: String, default: null, trim: true },
  },
  shift: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'HrShift', required: true },
    code: { type: String, default: null, trim: true },
    name: { type: String, default: null, trim: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    breakMinutes: { type: Number, min: 0, default: 0 },
    graceMinutes: { type: Number, min: 0, default: 0 },
    durationMinutes: { type: Number, min: 1, required: true },
    isOvernight: { type: Boolean, default: false },
  },
  calendarOverride: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'HrCalendarOverride', default: null },
    kind: { type: String, default: null, trim: true },
    name: { type: String, default: null, trim: true },
  },
}, { _id: false });

const overtimeRequestSchema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  workDateKey: { type: String, required: true, trim: true },
  plannedStartTime: { type: String, required: true, trim: true },
  plannedEndTime: { type: String, required: true, trim: true },
  plannedStartAt: { type: Date, required: true },
  plannedEndAt: { type: Date, required: true },
  startMinute: { type: Number, validate: integer, min: 0, max: 1439, required: true },
  endMinute: { type: Number, validate: integer, min: 1, max: 2399, required: true },
  requestedMinutes: { type: Number, validate: integer, min: 30, max: 960, required: true },
  approvedMinutes: { type: Number, validate: integer, min: 1, max: 960, default: null },
  calendarClass: { type: String, enum: ['WORKDAY', 'REST_DAY', 'HOLIDAY'], required: true },
  conflictMinuteKeys: { type: [Number], required: true, select: false },
  requesterSnapshot: { type: requesterSnapshotSchema, required: true },
  scheduleSnapshot: { type: scheduleSnapshotSchema, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: Object.values(hrRequestStatuses), default: hrRequestStatuses.PENDING },
  decision: { type: actorSchema, default: null },
  cancellation: { type: actorSchema, default: null },
}, { timestamps: true, versionKey: false });

overtimeRequestSchema.index({ profileId: 1, status: 1, workDateKey: -1 });
overtimeRequestSchema.index(
  { profileId: 1, conflictMinuteKeys: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED] },
    },
  },
);
overtimeRequestSchema.index({ 'requesterSnapshot.teamId': 1, status: 1, createdAt: -1 });
overtimeRequestSchema.index({ 'requesterSnapshot.departmentId': 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.HrOvertimeRequest
  || mongoose.model('HrOvertimeRequest', overtimeRequestSchema);
