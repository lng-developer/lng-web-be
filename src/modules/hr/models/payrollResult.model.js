const mongoose = require('mongoose');

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };
const money = { type: Number, required: true, validate: integer };

const employeeSnapshotSchema = new mongoose.Schema({
  employeeCode: { type: String, required: true, trim: true },
  fullName: { type: String, required: true, trim: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  jobTitle: { type: String, default: null, trim: true },
  employmentType: { type: String, default: null, trim: true },
  startDate: { type: String, default: null },
  avatarUrl: { type: String, default: null },
}, { _id: false });

const insuranceSchema = new mongoose.Schema({
  social: money,
  health: money,
  unemployment: money,
  total: money,
}, { _id: false });

const payrollResultSchema = new mongoose.Schema({
  payrollRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrPayrollRun', required: true, immutable: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true, immutable: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, immutable: true, index: true },
  employeeSnapshot: { type: employeeSnapshotSchema, required: true, immutable: true },
  formulaVersion: { type: String, required: true, trim: true, immutable: true },
  inputSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  standardWorkDays: { type: Number, required: true, min: 1, validate: integer, immutable: true },
  workUnits: { type: Number, required: true, min: 0, validate: integer, immutable: true },
  salaryFromWork: { ...money, immutable: true },
  overtimePay: { ...money, immutable: true },
  overtimeBreakdown: { type: [mongoose.Schema.Types.Mixed], default: [], immutable: true },
  totalAllowances: { ...money, immutable: true },
  allowanceBreakdown: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  adjustmentEarnings: { ...money, immutable: true },
  adjustmentDeductions: { ...money, immutable: true },
  grossIncome: { ...money, immutable: true },
  insurance: { type: insuranceSchema, required: true, immutable: true },
  personalIncomeTax: { ...money, immutable: true },
  totalDeductions: { ...money, immutable: true },
  netIncome: { ...money, immutable: true },
  status: { type: String, enum: ['DRAFT', 'FINALIZED', 'PAID'], default: 'DRAFT', index: true },
  version: { type: Number, min: 0, validate: integer, default: 0 },
  finalizedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  paidByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
}, { timestamps: true, versionKey: false });

payrollResultSchema.index({ payrollRunId: 1, profileId: 1 }, { unique: true });
payrollResultSchema.index({ accountId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.HrPayrollResult || mongoose.model('HrPayrollResult', payrollResultSchema);
