const mongoose = require('mongoose');
const { hrEmployeeStatuses } = require('../constants/hr.constants');

const scheduleStatuses = [hrEmployeeStatuses.ACTIVE, hrEmployeeStatuses.SUSPENDED];

const shiftAssignmentSchema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true, index: true },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrShift', required: true, index: true },
  workLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrWorkLocation', required: true, index: true },
  effectiveFrom: { type: String, required: true, index: true },
  effectiveTo: { type: String, default: null },
  status: { type: String, enum: scheduleStatuses, default: hrEmployeeStatuses.ACTIVE, index: true },
  createdBy: {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    fullName: { type: String, default: null, trim: true },
  },
}, { timestamps: true });

shiftAssignmentSchema.index({ profileId: 1, status: 1, effectiveFrom: 1, effectiveTo: 1 });

module.exports = mongoose.model('HrShiftAssignment', shiftAssignmentSchema);
