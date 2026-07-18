const mongoose = require('mongoose');
const { hrEmployeeStatuses } = require('../constants/hr.constants');

const scheduleStatuses = [hrEmployeeStatuses.ACTIVE, hrEmployeeStatuses.SUSPENDED];

const shiftSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  workLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrWorkLocation', default: null, index: true },
  startTime: { type: String, required: true, trim: true },
  endTime: { type: String, required: true, trim: true },
  breakMinutes: { type: Number, min: 0, default: 0 },
  graceMinutes: { type: Number, min: 0, default: 0 },
  workdays: { type: [{ type: Number, min: 1, max: 7 }], default: [1, 2, 3, 4, 5] },
  status: { type: String, enum: scheduleStatuses, default: hrEmployeeStatuses.ACTIVE, index: true },
}, { timestamps: true });

module.exports = mongoose.model('HrShift', shiftSchema);
