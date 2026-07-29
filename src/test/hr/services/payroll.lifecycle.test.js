const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const AuditEvent = require('../../../modules/audit/models/auditEvent.model');
const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const PayrollRun = require('../../../modules/hr/models/payrollRun.model');
const PayrollResult = require('../../../modules/hr/models/payrollResult.model');
const PayrollAdjustment = require('../../../modules/hr/models/payrollAdjustment.model');
const Notification = require('../../../modules/notification/models/notification.model');
const service = require('../../../modules/hr/services/payroll.service');
const adjustmentService = require('../../../modules/hr/services/payrollAdjustment.service');

const actorId = new mongoose.Types.ObjectId('681000000000000000000001');
const accountOneId = new mongoose.Types.ObjectId('681000000000000000000002');
const accountTwoId = new mongoose.Types.ObjectId('681000000000000000000003');
const profileOneId = new mongoose.Types.ObjectId('681000000000000000000004');
const profileTwoId = new mongoose.Types.ObjectId('681000000000000000000005');
const teamOneId = new mongoose.Types.ObjectId('681000000000000000000006');
const teamTwoId = new mongoose.Types.ObjectId('681000000000000000000007');

function resultPayload(payrollRunId, profileId, accountId, employeeCode) {
  return {
    payrollRunId,
    profileId,
    accountId,
    employeeSnapshot: { employeeCode, fullName: employeeCode },
    formulaVersion: 'legacy-v1',
    inputSnapshot: {
      formulaVersion: 'legacy-v1', period: { month: 7, year: 2026 },
      compensation: { baseSalary: 22000000, currency: 'VND' },
    },
    standardWorkDays: 22,
    workUnits: 220000,
    salaryFromWork: 22000000,
    overtimePay: 0,
    totalAllowances: 0,
    adjustmentEarnings: 0,
    adjustmentDeductions: 0,
    grossIncome: 22000000,
    insurance: { social: 1760000, health: 330000, unemployment: 220000, total: 2310000 },
    personalIncomeTax: 619000,
    totalDeductions: 2929000,
    netIncome: 19071000,
  };
}

async function seedDraftRun() {
  const run = await PayrollRun.create({
    month: 7, year: 2026, formulaVersion: 'legacy-v1', resultCount: 2, createdByAccountId: actorId,
  });
  await PayrollResult.insertMany([
    resultPayload(run._id, profileOneId, accountOneId, 'PAY-ONE'),
    resultPayload(run._id, profileTwoId, accountTwoId, 'PAY-TWO'),
  ]);
  return run;
}

let mongo;
jest.setTimeout(120000);

describe('payroll persisted lifecycle', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri('lng_web_be_task6_payroll_test'));
    await Promise.all([
      AuditEvent.init(), EmployeeProfile.init(), Notification.init(), PayrollAdjustment.init(), PayrollRun.init(), PayrollResult.init(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      AuditEvent.deleteMany({}), EmployeeProfile.deleteMany({}), Notification.deleteMany({}),
      PayrollAdjustment.deleteMany({}), PayrollResult.deleteMany({}), PayrollRun.deleteMany({}),
    ]);
    await EmployeeProfile.insertMany([
      { _id: profileOneId, accountId: accountOneId, employeeCode: 'PAY-ONE', fullName: 'Pay One', teamId: teamOneId, status: 'ACTIVE' },
      { _id: profileTwoId, accountId: accountTwoId, employeeCode: 'PAY-TWO', fullName: 'Pay Two', teamId: teamTwoId, status: 'ACTIVE' },
    ]);
  });

  test('finalize guards DRAFT and expectedVersion, persists audit/inbox once, and retry is stale', async () => {
    const run = await seedDraftRun();
    const draftRun = await service.getPayrollRun(String(run._id), { permissions: ['HR_PAYROLL:WRITE'] });
    const first = await service.finalizePayroll({ payrollRunId: String(run._id), expectedVersion: 0 }, { accountId: String(actorId) });
    const finalizedRun = await service.getPayrollRun(String(run._id), { permissions: ['HR_PAYROLL:WRITE'] });
    const finalizedWithoutWrite = await service.getPayrollRun(String(run._id), {});
    await expect(service.finalizePayroll(
      { payrollRunId: String(run._id), expectedVersion: 0 },
      { accountId: String(actorId) },
    )).rejects.toMatchObject({ statusCode: 409 });

    const [savedRun, results, inbox, audits] = await Promise.all([
      PayrollRun.findById(run._id).lean(),
      PayrollResult.find({ payrollRunId: run._id }).sort({ profileId: 1 }).lean(),
      Notification.find({}).lean(),
      AuditEvent.find({ entityType: 'HR_PAYROLL_RUN', entityId: String(run._id) }).lean(),
    ]);
    expect(first).toMatchObject({ status: 'FINALIZED', version: 1 });
    expect(savedRun).toMatchObject({ status: 'FINALIZED', version: 1 });
    expect(results.map((item) => [item.status, item.version])).toEqual([
      ['FINALIZED', 1], ['FINALIZED', 1],
    ]);
    expect(inbox).toHaveLength(2);
    expect(audits).toHaveLength(1);
    expect(finalizedRun.capabilities).toMatchObject({ email: true });
    expect(draftRun.capabilities).toMatchObject({ email: false });
    expect(finalizedWithoutWrite.capabilities).toMatchObject({ email: false });
  });

  test('limits payroll result list and detail to the manager team scope', async () => {
    const run = await seedDraftRun();
    const scopedManager = {
      scopes: [{ scopeType: 'team', scopeId: String(teamOneId), permissions: ['HR_PAYROLL:READ'] }],
    };

    const listed = await service.listPayrollResults({ payrollRunId: String(run._id), page: 1, limit: 20 }, scopedManager);

    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].profileId).toBe(String(profileOneId));
    await expect(service.getPayrollResult(String((await PayrollResult.findOne({ profileId: profileTwoId }).lean())._id), scopedManager))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('exports only scoped rows and audits filters without salary figures', async () => {
    const run = await seedDraftRun();
    const scopedManager = {
      accountId: String(actorId),
      scopes: [{ scopeType: 'team', scopeId: String(teamOneId), permissions: ['HR_PAYROLL:READ'] }],
    };

    const exported = await service.exportPayrollResults({ payrollRunId: String(run._id) }, scopedManager);
    const audit = await AuditEvent.findOne({ action: 'HR_PAYROLL_RESULTS_EXPORTED' }).lean();

    expect(exported).toMatchObject({ filename: 'payroll-results-2026-07.csv' });
    expect(exported.csv).toContain('Employee,Team,Base salary,Allowances,OT,Deductions,Gross,Net,Status');
    expect(exported.csv).toContain('PAY-ONE');
    expect(exported.csv).not.toContain('PAY-TWO');
    expect(audit).toMatchObject({
      actorAccountId: actorId,
      entityType: 'HR_PAYROLL_RESULT_EXPORT',
      metadata: { payrollRunId: String(run._id), rowCount: 1 },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/19071000|22000000|2929000/);
  });

  test('shadow stays unaudited while a live payroll run records sanitized creation once', async () => {
    const shadow = await service.calculatePayroll(
      { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: true },
      { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
    );
    expect(shadow).toMatchObject({ id: null, shadow: true, persisted: false, status: 'SHADOW' });
    expect(await Promise.all([
      PayrollRun.countDocuments({}), PayrollResult.countDocuments({}), AuditEvent.countDocuments({}), Notification.countDocuments({}),
    ])).toEqual([0, 0, 0, 0]);

    const live = await service.calculatePayroll(
      { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
      { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
    );
    expect(live).toMatchObject({ month: 7, year: 2026, status: 'DRAFT', resultCount: 1 });
    expect(await Promise.all([PayrollRun.countDocuments({}), PayrollResult.countDocuments({})])).toEqual([1, 1]);
    await expect(service.calculatePayroll(
      { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
      { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });

    const audits = await AuditEvent.find({ action: 'HR_PAYROLL_RUN_CREATED' }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'ACCOUNT',
      actorAccountId: actorId,
      entityType: 'HR_PAYROLL_RUN',
      entityId: live.id,
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      metadata: { month: 7, year: 2026, resultCount: 1 },
    });
    expect(audits[0].metadata).toEqual({ month: 7, year: 2026, resultCount: 1 });
  });

  test('mark-paid reports every supplied result, handles stale/unknown rows, and retry has no duplicate effects', async () => {
    const run = await seedDraftRun();
    await service.finalizePayroll({ payrollRunId: String(run._id), expectedVersion: 0 }, { accountId: String(actorId) });
    const results = await PayrollResult.find({ payrollRunId: run._id }).sort({ profileId: 1 }).lean();
    const unknownId = new mongoose.Types.ObjectId();

    const outcome = await service.markPayrollPaid({
      payrollRunId: String(run._id),
      payrollResultIds: [String(results[0]._id), String(results[1]._id), String(unknownId)],
      expectedVersion: 1,
    }, { accountId: String(actorId) });
    const retry = await service.markPayrollPaid({
      payrollRunId: String(run._id),
      payrollResultIds: [String(results[0]._id)],
      expectedVersion: 1,
    }, { accountId: String(actorId) });

    expect(outcome.results).toEqual([
      { payrollResultId: String(results[0]._id), success: true, status: 'PAID', version: 2 },
      { payrollResultId: String(results[1]._id), success: true, status: 'PAID', version: 2 },
      { payrollResultId: String(unknownId), success: false, code: 'NOT_FOUND' },
    ]);
    expect(retry.results).toEqual([
      { payrollResultId: String(results[0]._id), success: false, code: 'ALREADY_PAID' },
    ]);
    expect(await Notification.countDocuments({ type: 'PAYROLL_PAID' })).toBe(2);
    expect(await AuditEvent.countDocuments({ entityType: 'HR_PAYROLL_RESULT', action: 'PAID' })).toBe(2);
    expect((await PayrollRun.findById(run._id).lean()).status).toBe('PAID');
  });

  test('a stale mark-paid version is never reported as success', async () => {
    const run = await seedDraftRun();
    await service.finalizePayroll({ payrollRunId: String(run._id), expectedVersion: 0 }, { accountId: String(actorId) });
    const result = await PayrollResult.findOne({ payrollRunId: run._id }).lean();

    const outcome = await service.markPayrollPaid({
      payrollRunId: String(run._id), payrollResultIds: [String(result._id)], expectedVersion: 0,
    }, { accountId: String(actorId) });

    expect(outcome.results).toEqual([{ payrollResultId: String(result._id), success: false, code: 'STALE_VERSION' }]);
    expect((await PayrollResult.findById(result._id).lean()).status).toBe('FINALIZED');
  });

  test('calculation snapshots remain unchanged after finalization', async () => {
    const run = await seedDraftRun();
    await service.finalizePayroll({ payrollRunId: String(run._id), expectedVersion: 0 }, { accountId: String(actorId) });
    const result = await PayrollResult.findOne({ payrollRunId: run._id });
    result.inputSnapshot = { changed: true };
    await result.save();

    expect((await PayrollResult.findById(result._id).lean()).inputSnapshot).toEqual(expect.objectContaining({
      formulaVersion: 'legacy-v1', period: { month: 7, year: 2026 },
    }));
  });

  test('adjustment lifecycle refreshes DRAFT results and leaves FINALIZED snapshots immutable', async () => {
    const run = await service.calculatePayroll(
      { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
      { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
    );
    const initial = await PayrollResult.findOne({ payrollRunId: run.id, profileId: profileOneId }).lean();
    expect(initial.netIncome).toBe(0);

    const created = await adjustmentService.createAdjustment({
      profileId: String(profileOneId), month: 7, year: 2026, type: 'EARNING',
      code: 'ARREARS', name: 'Correction', amount: 100000, note: 'Draft correction',
    }, { accountId: String(actorId) });
    const afterCreate = await PayrollResult.findById(initial._id).lean();
    const updated = await adjustmentService.updateAdjustment(created.id, {
      amount: 120000, expectedVersion: 0,
    }, { accountId: String(actorId) });
    const afterUpdate = await PayrollResult.findById(initial._id).lean();
    const cancelled = await adjustmentService.cancelAdjustment(created.id, 1, { accountId: String(actorId) });
    const afterCancel = await PayrollResult.findById(initial._id).lean();

    expect([afterCreate.netIncome, afterUpdate.netIncome, afterCancel.netIncome]).toEqual([100000, 120000, 0]);
    expect(afterCreate.inputSnapshot.adjustments).toHaveLength(1);
    expect(afterUpdate.inputSnapshot.adjustments[0].amount).toBe(120000);
    expect(afterCancel.inputSnapshot.adjustments).toEqual([]);
    expect([created.requiresReview, updated.requiresReview, cancelled.requiresReview]).toEqual([false, false, false]);

    await service.finalizePayroll({ payrollRunId: run.id, expectedVersion: 0 }, { accountId: String(actorId) });
    const finalized = await PayrollResult.findById(initial._id).lean();
    const postFinalize = await adjustmentService.createAdjustment({
      profileId: String(profileOneId), month: 7, year: 2026, type: 'EARNING',
      code: 'ARREARS', name: 'Later correction', amount: 200000, note: 'Review required',
    }, { accountId: String(actorId) });

    expect(postFinalize.requiresReview).toBe(true);
    expect((await PayrollResult.findById(initial._id).lean()).inputSnapshot).toEqual(finalized.inputSnapshot);
  });
});
