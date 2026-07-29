const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const AttendanceDaily = require('../models/attendanceDaily.model');
const EmployeeProfile = require('../models/employeeProfile.model');
const Holiday = require('../models/holiday.model');
const LeaveRequest = require('../models/leaveRequest.model');
const OvertimeRequest = require('../models/overtimeRequest.model');
const PayrollAdjustment = require('../models/payrollAdjustment.model');
const PayrollResult = require('../models/payrollResult.model');
const PayrollRun = require('../models/payrollRun.model');
const SaturdayRotation = require('../models/saturdayRotation.model');

async function loadCalculationInputs({ month, year, profileIds = [] }) {
  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
  const nextDate = `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}-01`;
  const lastDate = new Date(Date.UTC(nextMonth.year, nextMonth.month - 1, 0)).toISOString().slice(0, 10);
  const periodStart = new Date(`${dateFrom}T00:00:00.000Z`);
  const periodEnd = new Date(`${lastDate}T23:59:59.999Z`);
  const profileFilter = {
    isDeleted: false,
    startDate: { $lte: periodEnd },
    $or: [{ endDate: null }, { endDate: { $gte: periodStart } }],
    ...(profileIds.length ? { _id: { $in: profileIds } } : {}),
  };
  const profiles = await EmployeeProfile.find(profileFilter)
    .select('+baseSalary +allowances +responsibilityAllowance')
    .sort({ employeeCode: 1, _id: 1 })
    .lean();
  const ids = profiles.map((profile) => profile._id);
  if (!ids.length) {
    return { profiles: [], attendance: [], leave: [], overtime: [], holidays: [], rotations: [], adjustments: [] };
  }

  const [attendance, leave, overtime, holidays, rotations, adjustments] = await Promise.all([
    AttendanceDaily.find({ profileId: { $in: ids }, workDateKey: { $gte: dateFrom, $lt: nextDate } }).lean(),
    LeaveRequest.find({
      profileId: { $in: ids }, status: 'APPROVED', startDateKey: { $lte: lastDate }, endDateKey: { $gte: dateFrom },
    }).lean(),
    OvertimeRequest.find({
      profileId: { $in: ids }, status: 'APPROVED', workDateKey: { $gte: dateFrom, $lt: nextDate },
    }).lean(),
    Holiday.find({ dateKey: { $gte: dateFrom, $lt: nextDate }, isActive: true }).lean(),
    SaturdayRotation.find({ month, year, employeeProfileIds: { $in: ids } }).lean(),
    PayrollAdjustment.find({ profileId: { $in: ids }, month, year, status: 'APPROVED' }).lean(),
  ]);
  return { profiles, attendance, leave, overtime, holidays, rotations, adjustments };
}

async function insertRunWithResults(runPayload, resultPayloads, session) {
  const [createdRun] = await PayrollRun.create([{ ...runPayload, resultCount: resultPayloads.length }], { session });
  if (resultPayloads.length) {
    await PayrollResult.insertMany(
      resultPayloads.map((result) => ({ ...result, payrollRunId: createdRun._id })),
      { session, ordered: true },
    );
  }
  return createdRun.toObject();
}

async function createRunWithResults(runPayload, resultPayloads, { session: providedSession } = {}) {
  if (providedSession) return insertRunWithResults(runPayload, resultPayloads, providedSession);

  const session = await mongoose.startSession();
  try {
    let run;
    await session.withTransaction(async () => {
      run = await insertRunWithResults(runPayload, resultPayloads, session);
    });
    return run;
  } finally {
    await session.endSession();
  }
}

async function findRunById(payrollRunId) {
  return PayrollRun.findById(payrollRunId).lean();
}

async function findRunByPeriod(month, year) {
  return PayrollRun.findOne({ month, year }).lean();
}

async function replaceDraftResultCalculation(payrollRunId, profileId, calculation) {
  const replacement = Object.fromEntries([
    'employeeSnapshot', 'formulaVersion', 'inputSnapshot', 'standardWorkDays', 'workUnits',
    'salaryFromWork', 'overtimePay', 'overtimeBreakdown', 'totalAllowances', 'allowanceBreakdown',
    'adjustmentEarnings', 'adjustmentDeductions', 'grossIncome', 'insurance', 'personalIncomeTax',
    'totalDeductions', 'netIncome',
  ].map((key) => [key, calculation[key]]));
  const result = await PayrollResult.collection.updateOne(
    { payrollRunId: new mongoose.Types.ObjectId(payrollRunId), profileId: new mongoose.Types.ObjectId(profileId), status: 'DRAFT' },
    { $set: { ...replacement, updatedAt: new Date() } },
  );
  if (result.matchedCount !== 1) return null;
  return PayrollResult.findOne({ payrollRunId, profileId, status: 'DRAFT' }).lean();
}

async function listRuns(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = {};
  if (query.month) filter.month = query.month;
  if (query.year) filter.year = query.year;
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    PayrollRun.find(filter).sort({ year: -1, month: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    PayrollRun.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function listResultsByRun(payrollRunId, { session } = {}) {
  const query = PayrollResult.find({ payrollRunId }).sort({ 'employeeSnapshot.employeeCode': 1, _id: 1 });
  if (session) query.session(session);
  return query.lean();
}

function buildResultRegisterFilter({ payrollRunId, status, q }, profileIds) {
  const filter = { payrollRunId, profileId: { $in: profileIds } };
  if (status) filter.status = status;
  const search = normalizeSearchTerm(q);
  if (search) {
    const match = buildCaseInsensitivePrefixRegex(search);
    filter.$or = [{ 'employeeSnapshot.employeeCode': match }, { 'employeeSnapshot.fullName': match }];
  }
  return filter;
}

async function listResultRegister({ payrollRunId, status, q, page, limit }, profileIds) {
  const pagination = normalizePagination({ page, limit });
  const filter = buildResultRegisterFilter({ payrollRunId, status, q }, profileIds);
  const [items, total] = await Promise.all([
    PayrollResult.find(filter).sort({ 'employeeSnapshot.employeeCode': 1, _id: 1 })
      .skip(getPaginationOffset(pagination)).limit(pagination.limit).lean(),
    PayrollResult.countDocuments(filter),
  ]);
  return { items, pagination: { ...pagination, total }, summary: { total } };
}

async function listAllResultRegister({ payrollRunId, status, q }, profileIds) {
  return PayrollResult.find(buildResultRegisterFilter({ payrollRunId, status, q }, profileIds))
    .sort({ 'employeeSnapshot.employeeCode': 1, _id: 1 })
    .lean();
}

async function listResultsForAccount(accountId, query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = { accountId, status: { $in: ['FINALIZED', 'PAID'] } };
  if (query.month || query.year) {
    const runs = await PayrollRun.find({
      ...(query.month ? { month: query.month } : {}), ...(query.year ? { year: query.year } : {}),
    }).select('_id').lean();
    filter.payrollRunId = { $in: runs.map((run) => run._id) };
  }
  const [items, total] = await Promise.all([
    PayrollResult.find(filter).sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    PayrollResult.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function finalizeRun(payrollRunId, expectedVersion, actorAccountId, occurredAt) {
  const session = await mongoose.startSession();
  try {
    let run;
    let results;
    await session.withTransaction(async () => {
      run = await PayrollRun.findOneAndUpdate(
        { _id: payrollRunId, status: 'DRAFT', version: expectedVersion },
        {
          $set: { status: 'FINALIZED', finalizedAt: occurredAt, finalizedByAccountId: actorAccountId },
          $inc: { version: 1 },
        },
        { returnDocument: 'after', runValidators: true, session },
      ).lean();
      if (!run) return;
      const update = await PayrollResult.updateMany(
        { payrollRunId, status: 'DRAFT', version: 0 },
        { $set: { status: 'FINALIZED', finalizedAt: occurredAt }, $inc: { version: 1 } },
        { runValidators: true, session },
      );
      if (update.matchedCount !== run.resultCount) throw new Error('Payroll result state does not match run state');
      results = await PayrollResult.find({ payrollRunId }).session(session).lean();
    });
    return run ? { run, results } : null;
  } finally {
    await session.endSession();
  }
}

async function transitionResultToPaid(payrollRunId, payrollResultId, expectedVersion, actorAccountId, occurredAt) {
  return PayrollResult.findOneAndUpdate(
    { _id: payrollResultId, payrollRunId, status: 'FINALIZED', version: expectedVersion },
    { $set: { status: 'PAID', paidAt: occurredAt, paidByAccountId: actorAccountId }, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function findResultById(payrollResultId) {
  return PayrollResult.findById(payrollResultId).lean();
}

async function markRunPaidWhenComplete(payrollRunId, occurredAt) {
  const remaining = await PayrollResult.exists({ payrollRunId, status: { $ne: 'PAID' } });
  if (remaining) return null;
  return PayrollRun.findOneAndUpdate(
    { _id: payrollRunId, status: 'FINALIZED' },
    { $set: { status: 'PAID', paidAt: occurredAt }, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function findFinalizedResultForPeriod(profileId, month, year) {
  const run = await PayrollRun.findOne({ month, year }).select('_id').lean();
  if (!run) return null;
  return PayrollResult.findOne({ payrollRunId: run._id, profileId, status: { $in: ['FINALIZED', 'PAID'] } }).lean();
}

async function listAdjustments(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = {};
  for (const key of ['profileId', 'month', 'year', 'status', 'type']) if (query[key] !== undefined) filter[key] = query[key];
  const [items, total] = await Promise.all([
    PayrollAdjustment.find(filter).sort({ year: -1, month: -1, createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    PayrollAdjustment.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function createAdjustment(payload) {
  return (await PayrollAdjustment.create(payload)).toObject();
}

async function findAdjustmentById(id) {
  return PayrollAdjustment.findById(id).lean();
}

async function updateAdjustment(id, expectedVersion, patch) {
  return PayrollAdjustment.findOneAndUpdate(
    { _id: id, status: 'APPROVED', version: expectedVersion },
    { $set: patch, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function cancelAdjustment(id, expectedVersion, actorAccountId) {
  return PayrollAdjustment.findOneAndUpdate(
    { _id: id, status: 'APPROVED', version: expectedVersion },
    { $set: { status: 'CANCELLED', updatedByAccountId: actorAccountId }, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  cancelAdjustment,
  createAdjustment,
  createRunWithResults,
  finalizeRun,
  findAdjustmentById,
  findFinalizedResultForPeriod,
  findResultById,
  findRunById,
  findRunByPeriod,
  listAdjustments,
  listResultsByRun,
  listResultRegister,
  listAllResultRegister,
  listResultsForAccount,
  listRuns,
  loadCalculationInputs,
  markRunPaidWhenComplete,
  replaceDraftResultCalculation,
  transitionResultToPaid,
  updateAdjustment,
};
