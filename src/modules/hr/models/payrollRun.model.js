const mongoose = require('mongoose');

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

const payrollRunSchema = new mongoose.Schema({
  month: { type: Number, required: true, min: 1, max: 12, validate: integer },
  year: { type: Number, required: true, min: 2000, max: 2100, validate: integer },
  formulaVersion: { type: String, required: true, trim: true, immutable: true },
  status: { type: String, enum: ['DRAFT', 'FINALIZED', 'PAID'], default: 'DRAFT', index: true },
  version: { type: Number, min: 0, validate: integer, default: 0 },
  resultCount: { type: Number, min: 0, validate: integer, default: 0, immutable: true },
  createdByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, immutable: true },
  finalizedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  finalizedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

payrollRunSchema.index({ month: 1, year: 1 }, { unique: true });
payrollRunSchema.index({ status: 1, year: -1, month: -1 });

module.exports = mongoose.models.HrPayrollRun || mongoose.model('HrPayrollRun', payrollRunSchema);
