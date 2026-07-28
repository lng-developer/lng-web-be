const mongoose = require('mongoose');

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

const payrollAdjustmentSchema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true, index: true },
  month: { type: Number, required: true, min: 1, max: 12, validate: integer, index: true },
  year: { type: Number, required: true, min: 2000, max: 2100, validate: integer, index: true },
  type: { type: String, enum: ['EARNING', 'ALLOWANCE', 'DEDUCTION'], required: true },
  code: { type: String, enum: ['BONUS', 'PENALTY', 'ADVANCE', 'ARREARS', 'OTHER'], required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  amount: { type: Number, required: true, min: 0, validate: integer },
  note: { type: String, default: null, trim: true, maxlength: 500 },
  status: { type: String, enum: ['APPROVED', 'CANCELLED'], default: 'APPROVED', index: true },
  version: { type: Number, min: 0, validate: integer, default: 0 },
  createdByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  updatedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
}, { timestamps: true, versionKey: false });

payrollAdjustmentSchema.index({ profileId: 1, year: 1, month: 1, status: 1 });

module.exports = mongoose.models.HrPayrollAdjustment || mongoose.model('HrPayrollAdjustment', payrollAdjustmentSchema);
