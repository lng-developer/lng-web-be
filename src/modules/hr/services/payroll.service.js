const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const auditPublic = require('../../audit/public');
const notificationPublic = require('../../notification/public');
const { hrPermissions } = require('../constants/hr.constants');
const { toPayrollResultDto, toPayrollRunDto, toShadowPayrollDto } = require('../dtos/payroll.dto');
const repository = require('../repositories/payroll.repository');
const { calculatePayrollResult, FORMULA_VERSION } = require('./payrollCalculation.service');

function appError(message, statusCode, code) {
  return new AppError(message, statusCode, true, code);
}

function conflict(message) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function isDuplicateKey(error) {
  return error?.code === 11000 || error?.cause?.code === 11000;
}

function groupByProfile(records) {
  const groups = new Map();
  for (const record of records || []) {
    const profileId = toId(record.profileId);
    if (!groups.has(profileId)) groups.set(profileId, []);
    groups.get(profileId).push(record);
  }
  return groups;
}

function standardWorkDays(year, month, profileId, rotations) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1) {
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0) count += 1;
  }
  const offDates = new Set((rotations || []).filter((rotation) => (
    (rotation.employeeProfileIds || []).some((id) => toId(id) === profileId)
  )).map((rotation) => rotation.workDateKey));
  return count - offDates.size;
}

function rotationOffDateKeys(profileId, rotations) {
  return (rotations || []).filter((rotation) => (
    (rotation.employeeProfileIds || []).some((id) => toId(id) === profileId)
  )).map((rotation) => rotation.workDateKey);
}

function capabilities(run, authContext = {}) {
  const permissions = authContext.permissions || [];
  return {
    finalize: run.status === 'DRAFT' && permissions.includes(hrPermissions.PAYROLL_FINALIZE),
    markPaid: run.status === 'FINALIZED' && permissions.includes(hrPermissions.PAYROLL_PAY),
    email: ['FINALIZED', 'PAID'].includes(run.status)
      && permissions.includes(hrPermissions.PAYROLL_WRITE),
  };
}

function calculateResults(inputs, month, year) {
  const attendance = groupByProfile(inputs.attendance);
  const leave = groupByProfile(inputs.leave);
  const overtime = groupByProfile(inputs.overtime);
  const adjustments = groupByProfile(inputs.adjustments);
  return inputs.profiles.map((profile) => {
    const profileId = toId(profile);
    return calculatePayrollResult({
      month,
      year,
      profile,
      standardWorkDays: standardWorkDays(year, month, profileId, inputs.rotations),
      rotationOffDateKeys: rotationOffDateKeys(profileId, inputs.rotations),
      attendance: attendance.get(profileId) || [],
      approvedLeave: leave.get(profileId) || [],
      approvedOvertime: overtime.get(profileId) || [],
      holidays: inputs.holidays,
      adjustments: adjustments.get(profileId) || [],
    });
  });
}

async function calculatePayroll({ month, year, profileIds = [], shadow = false }, actor = {}) {
  const inputs = await repository.loadCalculationInputs({ month, year, profileIds });
  const results = calculateResults(inputs, month, year);

  if (shadow) return toShadowPayrollDto({ month, year, results });
  if (!actor.accountId) throw appError('Payroll actor is required', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);

  try {
    const run = await repository.createRunWithResults({
      month, year, formulaVersion: FORMULA_VERSION, createdByAccountId: actor.accountId,
    }, results);
    return toPayrollRunDto(run, {
      results: await repository.listResultsByRun(toId(run)),
      capabilities: capabilities(run, actor),
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict(`Payroll run already exists for ${month}/${year}`);
    throw error;
  }
}

async function refreshDraftPayrollResult(profileId, month, year) {
  const run = await repository.findRunByPeriod(month, year);
  if (!run || run.status !== 'DRAFT') return null;
  const inputs = await repository.loadCalculationInputs({ month, year, profileIds: [profileId] });
  const [calculation] = calculateResults(inputs, month, year);
  if (!calculation) return null;
  return repository.replaceDraftResultCalculation(toId(run), profileId, calculation);
}

async function listPayrollRuns(query = {}, authContext = {}) {
  const result = await repository.listRuns(query);
  return {
    items: result.items.map((run) => toPayrollRunDto(run, { capabilities: capabilities(run, authContext) })),
    pagination: result.pagination,
  };
}

async function getPayrollRun(payrollRunId, authContext = {}) {
  const run = await repository.findRunById(payrollRunId);
  if (!run) throw notFound('Payroll run not found');
  return toPayrollRunDto(run, {
    results: await repository.listResultsByRun(payrollRunId),
    capabilities: capabilities(run, authContext),
  });
}

async function listMyPayrollResults(query = {}, authContext = {}) {
  if (!authContext.accountId) throw appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
  const result = await repository.listResultsForAccount(authContext.accountId, query);
  return {
    items: result.items.map((item) => toPayrollResultDto(item, { markPaid: false })),
    pagination: result.pagination,
  };
}

async function finalizePayroll({ payrollRunId, expectedVersion }, actor = {}) {
  const transitioned = await repository.finalizeRun(payrollRunId, expectedVersion, actor.accountId, new Date());
  if (!transitioned) throw conflict('Payroll run is not DRAFT at expectedVersion');

  await auditPublic.record({
    actorAccountId: actor.accountId,
    action: 'FINALIZED',
    entityType: 'HR_PAYROLL_RUN',
    entityId: payrollRunId,
    metadata: { month: transitioned.run.month, year: transitioned.run.year, resultCount: transitioned.results.length },
    deduplicationKey: `payroll-run:${payrollRunId}:FINALIZED`,
  });
  await Promise.all(transitioned.results.filter((result) => result.accountId).map((result) => (
    notificationPublic.notify({
      recipientAccountId: toId(result.accountId),
      type: 'PAYROLL_FINALIZED',
      title: 'Payroll finalized',
      message: `Your payroll for ${transitioned.run.month}/${transitioned.run.year} is ready.`,
      relatedResource: { type: 'payrollResult', id: toId(result) },
      deduplicationKey: `payroll:${toId(result)}:FINALIZED:${toId(result.accountId)}`,
    })
  )));
  return toPayrollRunDto(transitioned.run, {
    results: transitioned.results,
    capabilities: capabilities(transitioned.run, actor),
  });
}

async function markPayrollPaid({ payrollRunId, payrollResultIds, expectedVersion }, actor = {}) {
  const run = await repository.findRunById(payrollRunId);
  if (!run) throw notFound('Payroll run not found');
  const occurredAt = new Date();
  const outcomes = [];

  for (const payrollResultId of payrollResultIds) {
    const paid = await repository.transitionResultToPaid(
      payrollRunId, payrollResultId, expectedVersion, actor.accountId, occurredAt,
    );
    if (!paid) {
      const current = await repository.findResultById(payrollResultId);
      let code = 'NOT_FOUND';
      if (current && toId(current.payrollRunId) === payrollRunId) {
        code = current.status === 'PAID' ? 'ALREADY_PAID'
          : (current.version !== expectedVersion ? 'STALE_VERSION' : 'INVALID_STATE');
      }
      outcomes.push({ payrollResultId, success: false, code });
      continue;
    }

    outcomes.push({ payrollResultId, success: true, status: paid.status, version: paid.version });
    await auditPublic.record({
      actorAccountId: actor.accountId,
      action: 'PAID',
      entityType: 'HR_PAYROLL_RESULT',
      entityId: payrollResultId,
      metadata: { payrollRunId },
      deduplicationKey: `payroll-result:${payrollResultId}:PAID`,
    });
    if (paid.accountId) {
      await notificationPublic.notify({
        recipientAccountId: toId(paid.accountId),
        type: 'PAYROLL_PAID',
        title: 'Payroll paid',
        message: `Your payroll for ${run.month}/${run.year} was marked paid.`,
        relatedResource: { type: 'payrollResult', id: payrollResultId },
        deduplicationKey: `payroll:${payrollResultId}:PAID:${toId(paid.accountId)}`,
      });
    }
  }
  await repository.markRunPaidWhenComplete(payrollRunId, occurredAt);
  return {
    payrollRunId,
    matchedCount: outcomes.filter((outcome) => outcome.success).length,
    results: outcomes,
  };
}

module.exports = {
  calculatePayroll,
  finalizePayroll,
  getPayrollRun,
  listMyPayrollResults,
  listPayrollRuns,
  markPayrollPaid,
  refreshDraftPayrollResult,
};
