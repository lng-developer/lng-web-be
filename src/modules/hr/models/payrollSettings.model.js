const mongoose = require('mongoose');

const payrollSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  settings: { type: mongoose.Schema.Types.Mixed, required: true },
  version: { type: Number, min: 0, default: 0 },
  updatedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.HrPayrollSettings
  || mongoose.model('HrPayrollSettings', payrollSettingsSchema);
