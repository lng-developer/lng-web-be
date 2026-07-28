const mongoose = require('mongoose');
const { hrHolidayTypes } = require('../constants/hr.constants');

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  dateKey: { type: String, required: true, trim: true },
  isWorkDay: { type: Boolean, default: false },
  holidayType: { type: String, enum: Object.values(hrHolidayTypes), required: true },
  appliedDepartmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  appliedTeamIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  note: { type: String, default: null, trim: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

holidaySchema.index({ dateKey: 1 }, { unique: true });
holidaySchema.index({ isActive: 1, dateKey: 1 });

module.exports = mongoose.model('HrHoliday', holidaySchema);
