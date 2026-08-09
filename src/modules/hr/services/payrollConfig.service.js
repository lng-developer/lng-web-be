const path = require('path');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const PayrollSettings = require('../models/payrollSettings.model');

const DEFAULT_PAYROLL_SETTINGS = Object.freeze({
  formulaVersion: 'legacy-v1',
  adjustmentTypes: Object.freeze(['EARNING', 'ALLOWANCE', 'DEDUCTION']),
  adjustmentCodes: Object.freeze(['BONUS', 'PENALTY', 'ADVANCE', 'ARREARS', 'OTHER']),
  paidLeaveTypes: Object.freeze(['ANNUAL', 'BEREAVEMENT', 'WEDDING', 'PERSONAL_PAID']),
  workHoursPerDay: 8,
  workUnitScale: 10000,
  rateScale: 10000,
  probationRateBasisPoints: 8500,
  otRateBasisPoints: Object.freeze({
    weekday: 15000,
    weekend: 20000,
    holiday: 30000,
    weekday_night: 18000,
    weekend_night: 24000,
    holiday_night: 39000,
  }),
  insuranceRates: Object.freeze({ social: 800, health: 150, unemployment: 100 }),
  insuranceCap: 46800000,
  personalDeduction: 11000000,
  dependantDeduction: 4400000,
  pitBrackets: Object.freeze([
    [5000000, 500],
    [10000000, 1000],
    [18000000, 1500],
    [32000000, 2000],
    [52000000, 2500],
    [80000000, 3000],
    [Number.MAX_SAFE_INTEGER, 3500],
  ]),
  company: Object.freeze({
    name: 'LNG Group', logoUrl: null, address: '', taxCode: '',
    payrollEmail: '', payrollPhone: '', currency: 'VND',
  }),
});

function normalizeAdjustmentValues(values, fallback) {
  if (!Array.isArray(values)) return [...fallback];
  return values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function normalizeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeNumberPair([limit, rate]) {
  const normalized = [Number(limit), Number(rate)];
  if (!Number.isFinite(normalized[0]) || !Number.isFinite(normalized[1])) {
    throw new Error('Invalid payroll PIT bracket');
  }
  return normalized;
}

function loadPayrollSettingsOverride() {
  const raw = process.env.HR_PAYROLL_SETTINGS_PATH || null;
  if (!raw) return null;
  try {
    const fullPath = path.resolve(process.cwd(), raw);
    const fs = require('fs');
    const content = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function loadPayrollSettings() {
  const override = loadPayrollSettingsOverride();
  if (!override) return DEFAULT_PAYROLL_SETTINGS;
  return Object.freeze({
    ...DEFAULT_PAYROLL_SETTINGS,
    ...override,
    formulaVersion: String(override.formulaVersion || DEFAULT_PAYROLL_SETTINGS.formulaVersion),
    adjustmentTypes: Object.freeze(normalizeAdjustmentValues(override.adjustmentTypes, DEFAULT_PAYROLL_SETTINGS.adjustmentTypes)),
    adjustmentCodes: Object.freeze(normalizeAdjustmentValues(override.adjustmentCodes, DEFAULT_PAYROLL_SETTINGS.adjustmentCodes)),
    paidLeaveTypes: Object.freeze(normalizeAdjustmentValues(override.paidLeaveTypes, DEFAULT_PAYROLL_SETTINGS.paidLeaveTypes)),
    workHoursPerDay: normalizeNumber(Number(override.workHoursPerDay), DEFAULT_PAYROLL_SETTINGS.workHoursPerDay),
    workUnitScale: normalizeNumber(Number(override.workUnitScale), DEFAULT_PAYROLL_SETTINGS.workUnitScale),
    rateScale: normalizeNumber(Number(override.rateScale), DEFAULT_PAYROLL_SETTINGS.rateScale),
    probationRateBasisPoints: normalizeNumber(Number(override.probationRateBasisPoints), DEFAULT_PAYROLL_SETTINGS.probationRateBasisPoints),
    otRateBasisPoints: Object.freeze({
      ...DEFAULT_PAYROLL_SETTINGS.otRateBasisPoints,
      ...(override.otRateBasisPoints || {}),
    }),
    insuranceRates: Object.freeze({
      ...DEFAULT_PAYROLL_SETTINGS.insuranceRates,
      ...(override.insuranceRates || {}),
    }),
    insuranceCap: normalizeNumber(Number(override.insuranceCap), DEFAULT_PAYROLL_SETTINGS.insuranceCap),
    personalDeduction: normalizeNumber(Number(override.personalDeduction), DEFAULT_PAYROLL_SETTINGS.personalDeduction),
    dependantDeduction: normalizeNumber(Number(override.dependantDeduction), DEFAULT_PAYROLL_SETTINGS.dependantDeduction),
    pitBrackets: Object.freeze((Array.isArray(override.pitBrackets) ? override.pitBrackets : DEFAULT_PAYROLL_SETTINGS.pitBrackets)
      .map(normalizeNumberPair)),
    company: Object.freeze({ ...DEFAULT_PAYROLL_SETTINGS.company, ...(override.company || {}) }),
  });
}

const environmentSettings = loadPayrollSettings();

function normalizePayrollSettings(value = {}) {
  const override = { ...value };
  return {
    ...environmentSettings,
    ...override,
    adjustmentTypes: normalizeAdjustmentValues(override.adjustmentTypes, environmentSettings.adjustmentTypes),
    adjustmentCodes: normalizeAdjustmentValues(override.adjustmentCodes, environmentSettings.adjustmentCodes),
    paidLeaveTypes: normalizeAdjustmentValues(override.paidLeaveTypes, environmentSettings.paidLeaveTypes),
    otRateBasisPoints: { ...environmentSettings.otRateBasisPoints, ...(override.otRateBasisPoints || {}) },
    insuranceRates: { ...environmentSettings.insuranceRates, ...(override.insuranceRates || {}) },
    pitBrackets: (override.pitBrackets || environmentSettings.pitBrackets).map(normalizeNumberPair),
    company: { ...environmentSettings.company, ...(override.company || {}) },
  };
}

function toDto(document) {
  if (!document) return { ...normalizePayrollSettings(), version: 0, updatedAt: null };
  return {
    ...normalizePayrollSettings(document.settings),
    version: document.version,
    updatedAt: document.updatedAt || null,
  };
}

async function getPayrollSettings() {
  return toDto(await PayrollSettings.findOne({ key: 'default' }).lean());
}

async function updatePayrollSettings(payload, actor = {}) {
  const { expectedVersion, version: _version, updatedAt: _updatedAt, ...values } = payload;
  const current = await PayrollSettings.findOne({ key: 'default' }).lean();
  const settings = normalizePayrollSettings({ ...(current?.settings || {}), ...values });
  try {
    const updated = await PayrollSettings.findOneAndUpdate(
      { key: 'default', version: expectedVersion },
      {
        $set: { settings, updatedByAccountId: actor.accountId },
        $setOnInsert: { key: 'default' },
        $inc: { version: 1 },
      },
      { returnDocument: 'after', runValidators: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    return toDto(updated);
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError('Payroll settings are stale', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
    throw error;
  }
}

module.exports = {
  getPayrollSettings,
  updatePayrollSettings,
  DEFAULT_PAYROLL_SETTINGS,
};
