const mongoose = require('mongoose');
const {
  hrEmployeeStatuses,
  hrEmploymentTypes,
  hrWorkModes,
} = require('../constants/hr.constants');

function toOptionalString(value, { lowercase = false } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  return lowercase ? normalized.toLowerCase() : normalized;
}

const bankAccountSchema = new mongoose.Schema({
  bankName: { type: String, default: null, trim: true },
  accountNumber: { type: String, default: null, trim: true },
}, { _id: false });

const dependantSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  relation: { type: String, trim: true, uppercase: true },
  dob: { type: Date, default: null },
  gender: { type: String, trim: true, uppercase: true },
}, { _id: false });

const allowancesSchema = new mongoose.Schema({
  lunch: { type: Number, min: 0, default: 0 },
  fuel: { type: Number, min: 0, default: 0 },
  other: { type: Number, min: 0, default: 0 },
}, { _id: false });

const employeeProfileSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true, index: true },
  employeeCode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  fullName: { type: String, required: true, trim: true },
  gender: { type: String, default: null, trim: true, uppercase: true },
  birthDate: { type: Date, default: null },
  phoneNumber: { type: String, default: null, trim: true },
  address: { type: String, default: null, trim: true },
  avatarUrl: { type: String, default: null, trim: true, maxlength: 500 },
  avatarAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', default: null },
  personalEmail: { type: String, unique: true, sparse: true, set: (value) => toOptionalString(value, { lowercase: true }) },
  workEmail: { type: String, unique: true, sparse: true, set: (value) => toOptionalString(value, { lowercase: true }) },
  emergencyContact: {
    name: { type: String, default: null, trim: true },
    phone: { type: String, default: null, trim: true },
    relation: { type: String, default: null, trim: true },
  },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null, index: true },
  jobTitle: { type: String, default: null, trim: true },
  jobLevel: { type: String, default: null, trim: true },
  employmentType: { type: String, enum: Object.values(hrEmploymentTypes), default: hrEmploymentTypes.FULL_TIME },
  workMode: { type: String, enum: Object.values(hrWorkModes), default: hrWorkModes.ONSITE },
  startDate: { type: Date, default: Date.now },
  probationEndDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  status: { type: String, enum: Object.values(hrEmployeeStatuses), default: hrEmployeeStatuses.PROBATION, index: true },
  contractType: { type: String, default: null, trim: true },
  contractNumber: { type: String, default: null, trim: true },
  contractStartDate: { type: Date, default: null },
  contractEndDate: { type: Date, default: null },
  promotionDate: { type: Date, default: null },
  transferDate: { type: Date, default: null },
  dependantDetails: { type: [dependantSchema], default: [] },
  dependants: { type: Number, min: 0, default: 0 },
  identityCard: { type: String, unique: true, sparse: true, select: false, set: toOptionalString },
  taxIdentification: { type: String, unique: true, sparse: true, select: false, set: toOptionalString },
  socialInsuranceNumber: { type: String, unique: true, sparse: true, select: false, set: toOptionalString },
  bankAccount: { type: bankAccountSchema, default: () => ({}), select: false },
  baseSalary: { type: Number, min: 0, default: 0, select: false },
  baseCurrency: { type: String, default: 'VND', trim: true, uppercase: true },
  allowances: { type: allowancesSchema, default: () => ({}), select: false },
  responsibilityAllowance: { type: Number, min: 0, default: 0, select: false },
  isProfileUpdated: { type: Boolean, default: false },
  scheduleMutationVersion: { type: Number, default: 0, select: false },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

employeeProfileSchema.index({ isDeleted: 1, status: 1, employeeCode: 1 });
employeeProfileSchema.index({ isDeleted: 1, departmentId: 1, teamId: 1 });

module.exports = mongoose.model('HrEmployeeProfile', employeeProfileSchema);
