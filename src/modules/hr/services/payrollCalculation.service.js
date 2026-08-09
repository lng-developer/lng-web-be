const { DEFAULT_PAYROLL_SETTINGS } = require('./payrollConfig.service');
const { RATE_MINUTE_KEYS, resolveApprovedRateMinutes } = require('./overtimeRateAllocation.service');
const FORMULA_VERSION = DEFAULT_PAYROLL_SETTINGS.formulaVersion;
const WORK_UNIT_SCALE = DEFAULT_PAYROLL_SETTINGS.workUnitScale;

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function integerMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw new TypeError('Payroll money must be finite');
  return Math.round(number);
}

function dateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isEmployed(profile, workDateKey) {
  const start = dateKey(profile.startDate);
  const end = dateKey(profile.endDate);
  return (!start || workDateKey >= start) && (!end || workDateKey <= end);
}

function appliesToProfile(record, profile) {
  const departments = (record.appliedDepartmentIds || []).map(toId);
  const teams = (record.appliedTeamIds || []).map(toId);
  return (!departments.length && !teams.length)
    || departments.includes(toId(profile.departmentId))
    || teams.includes(toId(profile.teamId));
}

function multiplierFor(profile, workDateKey, settings) {
  const probationEnd = dateKey(profile.probationEndDate);
  if (probationEnd) return workDateKey < probationEnd ? settings.probationRateBasisPoints : settings.rateScale;
  return String(profile.status).toUpperCase() === 'PROBATION'
    ? settings.probationRateBasisPoints
    : settings.rateScale;
}

function periodMultiplierFor(profile, month, year, rotationOffDateKeys, settings) {
  const rotationOff = new Set(rotationOffDateKeys);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let eligibleDays = 0;
  let multiplierTotal = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const workDateKey = date.toISOString().slice(0, 10);
    if (date.getUTCDay() === 0 || rotationOff.has(workDateKey) || !isEmployed(profile, workDateKey)) continue;
    eligibleDays += 1;
    multiplierTotal += multiplierFor(profile, workDateKey, settings);
  }
  const fallback = multiplierFor(profile, `${year}-${String(month).padStart(2, '0')}-01`, settings);
  return eligibleDays
    ? { basisPoints: Math.round(multiplierTotal / eligibleDays), eligibleDays, multiplierTotal }
    : { basisPoints: fallback, eligibleDays: 1, multiplierTotal: fallback };
}

function roundRatio(numerator, denominator) {
  return denominator ? Math.round(numerator / denominator) : 0;
}

function calculateInsurance(baseSalary, settings) {
  const insuredSalary = Math.min(integerMoney(baseSalary), settings.insuranceCap);
  const insurance = Object.fromEntries(Object.entries(settings.insuranceRates).map(([key, rate]) => [
    key, roundRatio(insuredSalary * rate, settings.rateScale),
  ]));
  insurance.total = insurance.social + insurance.health + insurance.unemployment;
  return insurance;
}

function calculatePit(taxableIncome, settings) {
  let remaining = Math.max(0, integerMoney(taxableIncome));
  let previousLimit = 0;
  let taxNumerator = 0;
  for (const [limit, rate] of settings.pitBrackets) {
    const taxable = Math.min(remaining, limit - previousLimit);
    if (taxable <= 0) break;
    taxNumerator += taxable * rate;
    remaining -= taxable;
    previousLimit = limit;
  }
  return roundRatio(taxNumerator, settings.rateScale);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizeAttendance(records, profile, month, year, settings) {
  const periodPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  return (records || [])
    .map((record) => ({
      workDateKey: record.workDateKey,
      status: record.status,
      workUnits: Math.max(0, Math.round(Number(record.workDayValue || 0) * settings.workUnitScale)),
    }))
    .filter((record) => record.workDateKey?.startsWith(periodPrefix) && isEmployed(profile, record.workDateKey))
    .sort((left, right) => left.workDateKey.localeCompare(right.workDateKey));
}

function normalizeLeave(records, profile, month, year, settings) {
  const paidLeaveTypes = new Set(settings.paidLeaveTypes);
  const periodPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  return (records || []).flatMap((request) => (request.workingDateSnapshots || []).map((snapshot) => ({
    requestId: toId(request),
    leaveType: request.leaveType,
    workDateKey: snapshot.dateKey,
    units: Number(snapshot.units || 0),
    paid: paidLeaveTypes.has(String(request.leaveType).toUpperCase()),
  }))).filter((record) => (
    record.workDateKey?.startsWith(periodPrefix) && isEmployed(profile, record.workDateKey)
  )).sort((left, right) => left.workDateKey.localeCompare(right.workDateKey));
}

function normalizeHolidays(records, profile, month, year) {
  const periodPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  return (records || []).filter((holiday) => (
    holiday.dateKey?.startsWith(periodPrefix)
    && holiday.holidayType === 'PUBLIC_HOLIDAY'
    && !holiday.isWorkDay
    && holiday.isActive !== false
    && isEmployed(profile, holiday.dateKey)
    && appliesToProfile(holiday, profile)
  )).map((holiday) => ({
    holidayId: toId(holiday), workDateKey: holiday.dateKey, name: holiday.name || null,
  })).sort((left, right) => left.workDateKey.localeCompare(right.workDateKey));
}

function normalizeOvertime(records, profile, month, year) {
  const periodPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  return (records || []).filter((request) => (
    request.workDateKey?.startsWith(periodPrefix)
    && isEmployed(profile, request.workDateKey)
    && Number.isInteger(request.approvedMinutes)
    && request.approvedMinutes > 0
  )).map((request) => {
    const allocation = resolveApprovedRateMinutes(request);
    return {
      requestId: toId(request),
      workDateKey: request.workDateKey,
      approvedMinutes: request.approvedMinutes,
      calendarClass: request.calendarClass || 'WORKDAY',
      plannedStartAt: new Date(request.plannedStartAt).toISOString(),
      plannedEndAt: new Date(request.plannedEndAt).toISOString(),
      timezone: request.scheduleSnapshot?.timezone || 'Asia/Ho_Chi_Minh',
      ...allocation,
    };
  }).sort((left, right) => left.workDateKey.localeCompare(right.workDateKey));
}

function normalizeAdjustments(records) {
  return (records || []).filter((item) => ['APPROVED', 'ACTIVE'].includes(item.status || 'APPROVED'))
    .map((item) => ({
      adjustmentId: toId(item), type: item.type, code: item.code, name: item.name,
      amount: integerMoney(item.amount), note: item.note || null,
    }))
    .filter((item) => item.amount >= 0)
    .sort((left, right) => String(left.adjustmentId).localeCompare(String(right.adjustmentId)));
}

function calculatePayrollResult({
  month, year, profile, standardWorkDays, attendance = [], approvedLeave = [],
  approvedOvertime = [], holidays = [], adjustments = [], rotationOffDateKeys = [],
}, settings = DEFAULT_PAYROLL_SETTINGS) {
  if (!Number.isInteger(standardWorkDays) || standardWorkDays <= 0) {
    throw new TypeError('standardWorkDays must be a positive integer');
  }
  const baseSalary = integerMoney(profile.baseSalary);
  const normalizedAttendance = normalizeAttendance(attendance, profile, month, year, settings);
  const normalizedLeave = normalizeLeave(approvedLeave, profile, month, year, settings);
  const normalizedHolidays = normalizeHolidays(holidays, profile, month, year);
  const normalizedOvertime = normalizeOvertime(approvedOvertime, profile, month, year);
  const normalizedAdjustments = normalizeAdjustments(adjustments);

  const workByDate = new Map(normalizedAttendance.map((record) => [record.workDateKey, record.workUnits]));
  for (const leave of normalizedLeave) {
    if (!leave.paid) continue;
    const leaveUnits = Math.round((leave.units / 2) * settings.workUnitScale);
    workByDate.set(leave.workDateKey, Math.max(workByDate.get(leave.workDateKey) || 0, leaveUnits));
  }
  for (const holiday of normalizedHolidays) {
    workByDate.set(holiday.workDateKey, Math.max(workByDate.get(holiday.workDateKey) || 0, settings.workUnitScale));
  }

  let probationWorkUnits = 0;
  let officialWorkUnits = 0;
  for (const [workDateKey, workUnits] of workByDate) {
    if (multiplierFor(profile, workDateKey, settings) === settings.probationRateBasisPoints) probationWorkUnits += workUnits;
    else officialWorkUnits += workUnits;
  }
  const salaryDenominator = standardWorkDays * settings.workUnitScale * settings.rateScale;
  const probationSalary = roundRatio(baseSalary * probationWorkUnits * settings.probationRateBasisPoints, salaryDenominator);
  const officialSalary = roundRatio(baseSalary * officialWorkUnits * settings.rateScale, salaryDenominator);
  const salaryFromWork = probationSalary + officialSalary;
  const workUnits = probationWorkUnits + officialWorkUnits;

  const periodMultiplier = periodMultiplierFor(profile, month, year, rotationOffDateKeys, settings);
  const effectiveBaseSalary = roundRatio(
    baseSalary * periodMultiplier.multiplierTotal,
    settings.rateScale * periodMultiplier.eligibleDays,
  );
  const rateMinuteTotals = Object.fromEntries(RATE_MINUTE_KEYS.map((key) => [key, 0]));
  for (const request of normalizedOvertime) {
    for (const key of RATE_MINUTE_KEYS) rateMinuteTotals[key] += request.approvedRateMinutes[key];
  }
  const overtimeBreakdown = RATE_MINUTE_KEYS.map((rateClass) => {
    const approvedMinutes = rateMinuteTotals[rateClass];
    const rateBasisPoints = settings.otRateBasisPoints[rateClass];
    const amount = roundRatio(
      effectiveBaseSalary * approvedMinutes * rateBasisPoints,
      standardWorkDays * settings.workHoursPerDay * 60 * settings.rateScale,
    );
    return { rateClass, approvedMinutes, rateBasisPoints, amount };
  });
  const overtimePay = overtimeBreakdown.reduce((sum, item) => sum + item.amount, 0);

  const allowanceBreakdown = {
    lunch: integerMoney(profile.allowances?.lunch),
    fuel: integerMoney(profile.allowances?.fuel),
    other: integerMoney(profile.allowances?.other),
    responsibility: integerMoney(profile.responsibilityAllowance),
  };
  const totalAllowances = Object.values(allowanceBreakdown).reduce((sum, amount) => sum + amount, 0);
  const adjustmentEarnings = normalizedAdjustments
    .filter((item) => item.type !== 'DEDUCTION').reduce((sum, item) => sum + item.amount, 0);
  const adjustmentDeductions = normalizedAdjustments
    .filter((item) => item.type === 'DEDUCTION').reduce((sum, item) => sum + item.amount, 0);
  const grossIncome = salaryFromWork + overtimePay + totalAllowances + adjustmentEarnings;
  const insurance = calculateInsurance(effectiveBaseSalary, settings);
  const personalIncomeTax = calculatePit(
    grossIncome - insurance.total - settings.personalDeduction
      - (Number(profile.dependants || 0) * settings.dependantDeduction),
    settings,
  );
  const totalDeductions = insurance.total + personalIncomeTax + adjustmentDeductions;
  const netIncome = grossIncome - totalDeductions;

  const inputSnapshot = deepFreeze({
    formulaVersion: settings.formulaVersion,
    payrollSettings: settings,
    period: { month, year },
    profile: {
      profileId: toId(profile), accountId: toId(profile.accountId), employeeCode: profile.employeeCode,
      fullName: profile.fullName, departmentId: toId(profile.departmentId), teamId: toId(profile.teamId),
      status: profile.status, startDate: dateKey(profile.startDate), endDate: dateKey(profile.endDate),
      probationEndDate: dateKey(profile.probationEndDate), dependants: Number(profile.dependants || 0),
    },
    compensation: {
      baseSalary, currency: profile.baseCurrency || 'VND', effectiveBaseSalary,
      salaryMultiplierBasisPoints: periodMultiplier.basisPoints,
      allowanceBreakdown, totalAllowances,
    },
    attendance: {
      standardWorkDays, workUnits, probationWorkUnits, officialWorkUnits,
      rotationOffDateKeys: [...rotationOffDateKeys].sort(), records: normalizedAttendance,
    },
    leave: normalizedLeave,
    holidays: normalizedHolidays,
    overtime: normalizedOvertime,
    adjustments: normalizedAdjustments,
  });

  return {
    profileId: toId(profile),
    accountId: toId(profile.accountId),
    employeeSnapshot: {
      employeeCode: profile.employeeCode, fullName: profile.fullName,
      departmentId: toId(profile.departmentId), teamId: toId(profile.teamId),
      jobTitle: profile.jobTitle || null, employmentType: profile.employmentType || null,
      startDate: dateKey(profile.startDate),
      avatarUrl: profile.avatarAssetId ? `/api/hr/employee-profiles/${toId(profile)}/avatar` : (profile.avatarUrl || null),
    },
    formulaVersion: settings.formulaVersion,
    inputSnapshot,
    standardWorkDays,
    workUnits,
    salaryFromWork,
    overtimePay,
    overtimeBreakdown,
    totalAllowances,
    allowanceBreakdown,
    adjustmentEarnings,
    adjustmentDeductions,
    grossIncome,
    insurance,
    personalIncomeTax,
    totalDeductions,
    netIncome,
  };
}

module.exports = {
  FORMULA_VERSION,
  WORK_UNIT_SCALE,
  calculatePayrollResult,
};
