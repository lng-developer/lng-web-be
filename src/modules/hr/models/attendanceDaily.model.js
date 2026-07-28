const mongoose = require('mongoose');
const { hrAttendanceStatuses } = require('../constants/hr.constants');

const actorSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  actorName: { type: String, default: null, trim: true },
}, { _id: false });

const adjustmentValueSchema = new mongoose.Schema({
  status: { type: String, enum: Object.values(hrAttendanceStatuses), default: null },
  checkInAt: { type: Date, default: null },
  checkOutAt: { type: Date, default: null },
  lateMinutes: { type: Number, min: 0, default: 0 },
  earlyLeaveMinutes: { type: Number, min: 0, default: 0 },
  workedMinutes: { type: Number, min: 0, default: 0 },
}, { _id: false });

const manualAdjustmentSchema = new mongoose.Schema({
  ...actorSchema.obj,
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  adjustedAt: { type: Date, required: true },
  before: { type: adjustmentValueSchema, required: true },
  after: { type: adjustmentValueSchema, required: true },
}, { _id: false });

const leaveSegmentSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrLeaveRequest', required: true },
  portion: { type: String, enum: ['FULL_DAY', 'MORNING', 'AFTERNOON'], required: true },
  units: { type: Number, enum: [1, 2], required: true },
  attendanceStatus: {
    type: String,
    enum: [hrAttendanceStatuses.PAID_LEAVE, hrAttendanceStatuses.UNPAID_LEAVE],
    required: true,
  },
}, { _id: false });

const scheduleSnapshotSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrShiftAssignment', default: null },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  timezone: { type: String, required: true, trim: true },
  plannedStartAt: { type: Date, required: true },
  plannedEndAt: { type: Date, required: true },
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
    scopeType: { type: String, default: null, trim: true },
    scopeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, default: null, trim: true },
  },
}, { _id: false });

const attendanceDailySchema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true, index: true },
  workDateKey: { type: String, required: true, trim: true, index: true },
  status: {
    type: String,
    enum: Object.values(hrAttendanceStatuses),
    default: hrAttendanceStatuses.PRESENT,
    index: true,
  },
  workDayValue: { type: Number, min: 0, max: 1, default: 0 },
  calculationReason: { type: String, default: null, trim: true },
  checkInAt: { type: Date, default: null },
  checkOutAt: { type: Date, default: null },
  lateMinutes: { type: Number, min: 0, default: 0 },
  earlyLeaveMinutes: { type: Number, min: 0, default: 0 },
  workedMinutes: { type: Number, min: 0, default: 0 },
  source: {
    type: String,
    enum: ['SELF_SERVICE', 'MANAGED', 'LEAVE_RECONCILIATION', 'SQL_ATTENDANCE'],
    required: true,
  },
  isManualEdited: { type: Boolean, default: false },
  sourceBatchIds: { type: [String], default: [] },
  scheduleSnapshot: { type: scheduleSnapshotSchema, required: true },
  leaveSegments: { type: [leaveSegmentSchema], default: [] },
  manualAdjustments: { type: [manualAdjustmentSchema], default: [] },
}, { timestamps: true });

attendanceDailySchema.index({ profileId: 1, workDateKey: 1 }, { unique: true });
attendanceDailySchema.index({ workDateKey: -1, status: 1 });
attendanceDailySchema.index({ 'scheduleSnapshot.departmentId': 1, workDateKey: -1 });
attendanceDailySchema.index({ 'scheduleSnapshot.teamId': 1, workDateKey: -1 });
attendanceDailySchema.index({ 'leaveSegments.requestId': 1 });

module.exports = mongoose.model('HrAttendanceDaily', attendanceDailySchema);
