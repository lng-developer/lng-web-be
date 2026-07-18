const mongoose = require('mongoose');
const { hrCalendarOverrideKinds, hrEmployeeStatuses } = require('../constants/hr.constants');

const scheduleStatuses = [hrEmployeeStatuses.ACTIVE, hrEmployeeStatuses.SUSPENDED];
const calendarScopeTypes = ['GLOBAL', 'WORK_LOCATION', 'DEPARTMENT', 'TEAM', 'PROFILE'];

const calendarOverrideSchema = new mongoose.Schema({
  dateKey: { type: String, required: true, index: true },
  kind: { type: String, enum: Object.values(hrCalendarOverrideKinds), required: true },
  scopeType: { type: String, enum: calendarScopeTypes, required: true },
  scopeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, required: true, trim: true },
  status: { type: String, enum: scheduleStatuses, default: hrEmployeeStatuses.ACTIVE, index: true },
  createdBy: {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    fullName: { type: String, default: null, trim: true },
  },
}, { timestamps: true });

calendarOverrideSchema.index(
  { dateKey: 1, scopeType: 1, scopeId: 1 },
  { unique: true, partialFilterExpression: { status: hrEmployeeStatuses.ACTIVE } },
);

module.exports = mongoose.model('HrCalendarOverride', calendarOverrideSchema);
