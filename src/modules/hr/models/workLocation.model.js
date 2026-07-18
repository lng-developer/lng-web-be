const mongoose = require('mongoose');
const { hrEmployeeStatuses } = require('../constants/hr.constants');

const scheduleStatuses = [hrEmployeeStatuses.ACTIVE, hrEmployeeStatuses.SUSPENDED];

const workLocationSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  timezone: { type: String, required: true, trim: true },
  status: { type: String, enum: scheduleStatuses, default: hrEmployeeStatuses.ACTIVE, index: true },
}, { timestamps: true });

module.exports = mongoose.model('HrWorkLocation', workLocationSchema);
