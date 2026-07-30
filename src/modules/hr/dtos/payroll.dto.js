const { WORK_UNIT_SCALE } = require('../services/payrollCalculation.service');

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toPayrollResultDto(result, capabilities, { teamName = null } = {}) {
  if (!result) return null;
  return {
    id: toId(result),
    payrollRunId: toId(result.payrollRunId),
    profileId: toId(result.profileId),
    employee: result.employeeSnapshot ? { ...result.employeeSnapshot, teamName } : null,
    formulaVersion: result.formulaVersion,
    inputSnapshot: result.inputSnapshot,
    baseSalary: result.inputSnapshot?.compensation?.baseSalary ?? 0,
    standardWorkDays: result.standardWorkDays,
    workUnits: result.workUnits,
    workDays: result.workUnits / WORK_UNIT_SCALE,
    salaryFromWork: result.salaryFromWork,
    overtimePay: result.overtimePay,
    overtimeBreakdown: result.overtimeBreakdown || [],
    totalAllowances: result.totalAllowances,
    allowanceBreakdown: result.allowanceBreakdown || {},
    adjustmentEarnings: result.adjustmentEarnings,
    adjustmentDeductions: result.adjustmentDeductions,
    grossIncome: result.grossIncome,
    insurance: result.insurance,
    personalIncomeTax: result.personalIncomeTax,
    totalDeductions: result.totalDeductions,
    netIncome: result.netIncome,
    status: result.status,
    version: result.version,
    finalizedAt: result.finalizedAt || null,
    paidAt: result.paidAt || null,
    capabilities: capabilities || { markPaid: false },
    createdAt: result.createdAt || null,
    updatedAt: result.updatedAt || null,
  };
}

function toPayrollRunDto(run, { results, capabilities, teamNamesById } = {}) {
  if (!run) return null;
  return {
    id: toId(run),
    month: run.month,
    year: run.year,
    formulaVersion: run.formulaVersion,
    status: run.status,
    version: run.version,
    resultCount: run.resultCount,
    finalizedAt: run.finalizedAt || null,
    paidAt: run.paidAt || null,
    capabilities: capabilities || { finalize: false, markPaid: false },
    ...(results ? { results: results.map((result) => toPayrollResultDto(result, {
      markPaid: Boolean(capabilities?.markPaid && result.status === 'FINALIZED'),
    }, { teamName: teamNamesById?.get(toId(result.employeeSnapshot?.teamId)) || null })) } : {}),
    createdAt: run.createdAt || null,
    updatedAt: run.updatedAt || null,
  };
}

function toShadowPayrollDto({ month, year, results }) {
  return {
    id: null,
    month,
    year,
    shadow: true,
    persisted: false,
    status: 'SHADOW',
    capabilities: { finalize: false, markPaid: false },
    results: results.map((result) => toPayrollResultDto({ ...result, status: 'SHADOW', version: 0 })),
  };
}

function toAdjustmentDto(adjustment, options = {}) {
  if (!adjustment) return null;
  return {
    id: toId(adjustment),
    profileId: toId(adjustment.profileId),
    month: adjustment.month,
    year: adjustment.year,
    type: adjustment.type,
    code: adjustment.code,
    name: adjustment.name,
    amount: adjustment.amount,
    note: adjustment.note || null,
    status: adjustment.status,
    version: adjustment.version,
    requiresReview: Boolean(options.requiresReview),
    draftPayrollRefreshed: Boolean(options.draftPayrollRefreshed),
    createdAt: adjustment.createdAt || null,
    updatedAt: adjustment.updatedAt || null,
  };
}

module.exports = { toAdjustmentDto, toPayrollResultDto, toPayrollRunDto, toShadowPayrollDto };
