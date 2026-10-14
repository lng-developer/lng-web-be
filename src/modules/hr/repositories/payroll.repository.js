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

async function loadCalculationInputs({ month, year, profileIds = [] }, { session } = {}) {
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
    .session(session || null)
    .lean();
  const ids = profiles.map((profile) => profile._id);
  if (!ids.length) {
    return { profiles: [], attendance: [], leave: [], overtime: [], holidays: [], rotations: [], adjustments: [] };
  }

  const [attendance, leave, overtime, holidays, rotations, adjustments] = await Promise.all([
    AttendanceDaily.find({ profileId: { $in: ids }, workDateKey: { $gte: dateFrom, $lt: nextDate } }).session(session || null).lean(),
    LeaveRequest.find({
      profileId: { $in: ids }, status: 'APPROVED', startDateKey: { $lte: lastDate }, endDateKey: { $gte: dateFrom },
    }).session(session || null).lean(),
    OvertimeRequest.find({
      profileId: { $in: ids }, status: 'APPROVED', workDateKey: { $gte: dateFrom, $lt: nextDate },
    }).session(session || null).lean(),
    Holiday.find({ dateKey: { $gte: dateFrom, $lt: nextDate }, isActive: true }).session(session || null).lean(),
    SaturdayRotation.find({ month, year, employeeProfileIds: { $in: ids } }).session(session || null).lean(),
    PayrollAdjustment.find({ profileId: { $in: ids }, month, year, status: 'APPROVED' }).session(session || null).lean(),
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

async function findRunByPeriod(month, year, { session } = {}) {
  return PayrollRun.findOne({ month, year }).session(session || null).lean();
}

async function replaceDraftResultCalculation(payrollRunId, profileId, calculation, { session } = {}) {
  const replacement = Object.fromEntries([
    'employeeSnapshot', 'formulaVersion', 'inputSnapshot', 'standardWorkDays', 'workUnits',
    'salaryFromWork', 'overtimePay', 'overtimeBreakdown', 'totalAllowances', 'allowanceBreakdown',
    'adjustmentEarnings', 'adjustmentDeductions', 'grossIncome', 'insurance', 'personalIncomeTax',
    'totalDeductions', 'netIncome',
  ].map((key) => [key, calculation[key]]));
  const result = await PayrollResult.collection.updateOne(
    { payrollRunId: new mongoose.Types.ObjectId(payrollRunId), profileId: new mongoose.Types.ObjectId(profileId), status: 'DRAFT' },
    { $set: { ...replacement, updatedAt: new Date() } },
    { session },
  );
  if (result.matchedCount !== 1) return null;
  return PayrollResult.findOne({ payrollRunId, profileId, status: 'DRAFT' }).session(session || null).lean();
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

async function getLatestRunSummary() {
  const run = await PayrollRun.findOne({}).sort({ year: -1, month: -1, _id: -1 }).lean();
  if (!run) return null;
  const [aggregate = {}] = await PayrollResult.aggregate([
    { $match: { payrollRunId: run._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        draft: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
        finalized: { $sum: { $cond: [{ $eq: ['$status', 'FINALIZED'] }, 1, 0] } },
        paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
        grossIncome: { $sum: '$grossIncome' },
        netIncome: { $sum: '$netIncome' },
      },
    },
  ]);
  const pendingAdjustments = await PayrollAdjustment.countDocuments({
    month: run.month,
    year: run.year,
    status: 'APPROVED',
  });
  return {
    id: String(run._id),
    month: run.month,
    year: run.year,
    status: run.status,
    resultCount: run.resultCount,
    finalizedAt: run.finalizedAt || null,
    paidAt: run.paidAt || null,
    pendingAdjustments,
    summary: {
      total: aggregate.total || 0,
      statusCounts: {
        DRAFT: aggregate.draft || 0,
        FINALIZED: aggregate.finalized || 0,
        PAID: aggregate.paid || 0,
      },
      amounts: {
        grossIncome: aggregate.grossIncome || 0,
        netIncome: aggregate.netIncome || 0,
      },
    },
  };
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

async function listResultRegister({ payrollRunId, status, q, page, limit }, profileIds, summaryProfileIds = profileIds) {
  const pagination = normalizePagination({ page, limit });
  const filter = buildResultRegisterFilter({ payrollRunId, status, q }, profileIds);
  const summaryFilter = buildResultRegisterFilter(
    { payrollRunId: new mongoose.Types.ObjectId(payrollRunId) },
    summaryProfileIds.map((profileId) => new mongoose.Types.ObjectId(profileId)),
  );
  const [items, total, [aggregate]] = await Promise.all([
    PayrollResult.find(filter).sort({ 'employeeSnapshot.employeeCode': 1, _id: 1 })
      .skip(getPaginationOffset(pagination)).limit(pagination.limit).lean(),
    PayrollResult.countDocuments(filter),
    PayrollResult.aggregate([
      { $match: summaryFilter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          draft: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
          finalized: { $sum: { $cond: [{ $eq: ['$status', 'FINALIZED'] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
          grossIncome: { $sum: '$grossIncome' },
          totalDeductions: { $sum: '$totalDeductions' },
          netIncome: { $sum: '$netIncome' },
          unpaidNetIncome: { $sum: { $cond: [{ $ne: ['$status', 'PAID'] }, '$netIncome', 0] } },
          paidNetIncome: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, '$netIncome', 0] } },
        },
      },
    ]),
  ]);
  return {
    items,
    pagination: { ...pagination, total },
    summary: {
      total: aggregate?.total || 0,
      statusCounts: {
        DRAFT: aggregate?.draft || 0,
        FINALIZED: aggregate?.finalized || 0,
        PAID: aggregate?.paid || 0,
      },
      amounts: {
        grossIncome: aggregate?.grossIncome || 0,
        totalDeductions: aggregate?.totalDeductions || 0,
        netIncome: aggregate?.netIncome || 0,
        unpaidNetIncome: aggregate?.unpaidNetIncome || 0,
        paidNetIncome: aggregate?.paidNetIncome || 0,
      },
    },
  };
}

async function listAllResultRegister({ payrollRunId, status, q }, profileIds) {
  return PayrollResult.find(buildResultRegisterFilter({ payrollRunId, status, q }, profileIds))
    .sort({ 'employeeSnapshot.employeeCode': 1, _id: 1 })
    .lean();
}

async function listResultsForAccount(accountId, query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = { accountId, status: { $in: ['FINALIZED', 'PAID'] } };
  if (query.resultId) filter._id = query.resultId;
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

async function finalizeRunInSession(payrollRunId, expectedVersion, actorAccountId, occurredAt, session) {
  const run = await PayrollRun.findOneAndUpdate(
    { _id: payrollRunId, status: 'DRAFT', version: expectedVersion },
    {
      $set: { status: 'FINALIZED', finalizedAt: occurredAt, finalizedByAccountId: actorAccountId },
      $inc: { version: 1 },
    },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
  if (!run) return null;
  const update = await PayrollResult.updateMany(
    { payrollRunId, status: 'DRAFT', version: 0 },
    { $set: { status: 'FINALIZED', finalizedAt: occurredAt }, $inc: { version: 1 } },
    { runValidators: true, session },
  );
  if (update.matchedCount !== run.resultCount) throw new Error('Payroll result state does not match run state');
  const results = await PayrollResult.find({ payrollRunId }).session(session).lean();
  return { run, results };
}

async function finalizeRun(payrollRunId, expectedVersion, actorAccountId, occurredAt, { session: providedSession } = {}) {
  if (providedSession) {
    return finalizeRunInSession(payrollRunId, expectedVersion, actorAccountId, occurredAt, providedSession);
  }
  const session = await mongoose.startSession();
  try {
    let transitioned;
    await session.withTransaction(async () => {
      transitioned = await finalizeRunInSession(payrollRunId, expectedVersion, actorAccountId, occurredAt, session);
    });
    return transitioned;
  } finally {
    await session.endSession();
  }
}

async function transitionResultToPaid(
  payrollRunId, payrollResultId, expectedVersion, actorAccountId, occurredAt, { session } = {},
) {
  return PayrollResult.findOneAndUpdate(
    { _id: payrollResultId, payrollRunId, status: 'FINALIZED', version: expectedVersion },
    { $set: { status: 'PAID', paidAt: occurredAt, paidByAccountId: actorAccountId }, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true, session },
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

async function createAdjustment(payload, { session } = {}) {
  const [adjustment] = await PayrollAdjustment.create([payload], { session });
  return adjustment.toObject();
}

async function createAdjustments(payloads, { session } = {}) {
  if (!payloads.length) return [];
  const adjustments = await PayrollAdjustment.create(payloads, { session });
  return adjustments.map((item) => (item.toObject ? item.toObject() : item));
}

async function findAdjustmentById(id, { session } = {}) {
  return PayrollAdjustment.findById(id).session(session || null).lean();
}

async function updateAdjustment(id, expectedVersion, patch, { session } = {}) {
  return PayrollAdjustment.findOneAndUpdate(
    { _id: id, status: 'APPROVED', version: expectedVersion },
    { $set: patch, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function cancelAdjustment(id, expectedVersion, actorAccountId, { session } = {}) {
  return PayrollAdjustment.findOneAndUpdate(
    { _id: id, status: 'APPROVED', version: expectedVersion },
    { $set: { status: 'CANCELLED', updatedByAccountId: actorAccountId }, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

module.exports = {
  cancelAdjustment,
  createAdjustment,
  createAdjustments,
  createRunWithResults,
  finalizeRun,
  findAdjustmentById,
  findFinalizedResultForPeriod,
  getLatestRunSummary,
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
