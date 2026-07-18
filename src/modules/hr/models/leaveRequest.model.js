const mongoose = require('mongoose');
const {
  hrAttendanceStatuses,
  hrLeaveTypes,
  hrRequestStatuses,
} = require('../constants/hr.constants');

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

const workingDateSnapshotSchema = new mongoose.Schema({
  dateKey: { type: String, required: true, trim: true },
  units: { type: Number, enum: [1, 2], required: true },
  scheduleSnapshot: { type: scheduleSnapshotSchema, required: true },
}, { _id: false });

const leaveRequestSchema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  year: { type: Number, validate: integer, min: 2000, max: 2100, required: true },
  leaveType: { type: String, enum: Object.values(hrLeaveTypes), required: true },
  attendanceStatus: {
    type: String,
    enum: [hrAttendanceStatuses.PAID_LEAVE, hrAttendanceStatuses.UNPAID_LEAVE],
    required: true,
  },
  portion: { type: String, enum: ['FULL_DAY', 'MORNING', 'AFTERNOON'], required: true },
  startDateKey: { type: String, required: true, trim: true },
  endDateKey: { type: String, required: true, trim: true },
  workingDateKeys: { type: [String], required: true },
  conflictKeys: { type: [String], required: true },
  workingDateSnapshots: { type: [workingDateSnapshotSchema], required: true },
  requestedUnits: { type: Number, validate: integer, min: 1, required: true },
  requesterSnapshot: { type: requesterSnapshotSchema, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: Object.values(hrRequestStatuses), default: hrRequestStatuses.PENDING },
  decision: { type: actorSchema, default: null },
  cancellation: { type: actorSchema, default: null },
}, { timestamps: true, versionKey: false });

leaveRequestSchema.index({ profileId: 1, status: 1, startDateKey: 1, endDateKey: 1 });
leaveRequestSchema.index(
  { profileId: 1, conflictKeys: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED] },
    },
  },
);
leaveRequestSchema.index({ 'requesterSnapshot.teamId': 1, status: 1, createdAt: -1 });
leaveRequestSchema.index({ 'requesterSnapshot.departmentId': 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.HrLeaveRequest
  || mongoose.model('HrLeaveRequest', leaveRequestSchema);
