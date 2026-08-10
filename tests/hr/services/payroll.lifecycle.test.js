const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const AuditEvent = require('../../../src/modules/audit/models/auditEvent.model');
const EmployeeProfile = require('../../../src/modules/hr/models/employeeProfile.model');
const PayrollRun = require('../../../src/modules/hr/models/payrollRun.model');
const PayrollResult = require('../../../src/modules/hr/models/payrollResult.model');
const PayrollAdjustment = require('../../../src/modules/hr/models/payrollAdjustment.model');
const Notification = require('../../../src/modules/notification/models/notification.model');
const auditPublic = require('../../../src/modules/audit/public');
const notificationPublic = require('../../../src/modules/notification/public');
const service = require('../../../src/modules/hr/services/payroll.service');
const adjustmentService = require('../../../src/modules/hr/services/payrollAdjustment.service');

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
      { _id: profileOneId, accountId: accountOneId, employeeCode: 'PAY-ONE', fullName: 'Pay One', teamId: teamOneId, status: 'ACTIVE', startDate: new Date('2026-01-01T00:00:00.000Z'), baseSalary: 22000000 },
      { _id: profileTwoId, accountId: accountTwoId, employeeCode: 'PAY-TWO', fullName: 'Pay Two', teamId: teamTwoId, status: 'ACTIVE', startDate: new Date('2026-01-01T00:00:00.000Z'), baseSalary: 22000000 },
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
      AuditEvent.find({ entityType: 'HR_PAYROLL_RUN', entityId: String(run._id), action: 'FINALIZED' }).lean(),
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

  test('finalization audit failure rolls back run and results so the same version can retry', async () => {
    const run = await seedDraftRun();
    const auditSpy = jest.spyOn(auditPublic, 'record').mockRejectedValueOnce(new Error('forced finalize audit failure'));

    try {
      await expect(service.finalizePayroll(
        { payrollRunId: String(run._id), expectedVersion: 0 },
        { accountId: String(actorId) },
      )).rejects.toThrow('forced finalize audit failure');

      expect(await PayrollRun.findById(run._id).lean()).toMatchObject({ status: 'DRAFT', version: 0 });
      expect((await PayrollResult.find({ payrollRunId: run._id }).lean())
        .map(({ status, version }) => [status, version])).toEqual([['DRAFT', 0], ['DRAFT', 0]]);

      await expect(service.finalizePayroll(
        { payrollRunId: String(run._id), expectedVersion: 0 },
        { accountId: String(actorId) },
      )).resolves.toMatchObject({ status: 'FINALIZED', version: 1 });
    } finally {
      auditSpy.mockRestore();
    }
  });

  test('finalization notification failure does not fail the committed mutation', async () => {
    const run = await seedDraftRun();
    const notificationSpy = jest.spyOn(notificationPublic, 'notify')
      .mockRejectedValueOnce(new Error('forced notification failure'));

    try {
      await expect(service.finalizePayroll(
        { payrollRunId: String(run._id), expectedVersion: 0 },
        { accountId: String(actorId) },
      )).resolves.toMatchObject({ status: 'FINALIZED', version: 1 });
      expect(await PayrollRun.findById(run._id).lean()).toMatchObject({ status: 'FINALIZED', version: 1 });
      expect(await AuditEvent.countDocuments({ entityId: String(run._id), action: 'FINALIZED' })).toBe(1);
    } finally {
      notificationSpy.mockRestore();
    }
  });

  test('limits payroll result list and detail to the manager team scope', async () => {
    const run = await seedDraftRun();
    const scopedManager = {
      scopes: [{ scopeType: 'team', scopeId: String(teamOneId), permissions: ['HR_PAYROLL:READ'] }],
    };

    const listed = await service.listPayrollResults({ payrollRunId: String(run._id), page: 1, limit: 20 }, scopedManager);

    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].profileId).toBe(String(profileOneId));
    expect(listed.summary).toMatchObject({
      total: 1,
      statusCounts: { DRAFT: 1, FINALIZED: 0, PAID: 0 },
      amounts: { netIncome: 19071000, unpaidNetIncome: 19071000, paidNetIncome: 0 },
    });
    await expect(service.getPayrollResult(String((await PayrollResult.findOne({ profileId: profileTwoId }).lean())._id), scopedManager))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('summarizes the authorized payroll period independently of table filters', async () => {
    const run = await seedDraftRun();
    await PayrollResult.updateOne(
      { payrollRunId: run._id, profileId: profileTwoId },
      { $set: { status: 'PAID' } },
    );

    const listed = await service.listPayrollResults({
      payrollRunId: String(run._id), status: 'DRAFT', q: 'PAY-ONE', page: 1, limit: 20,
    }, { permissions: ['HR_PAYROLL:READ'] });

    expect(listed.items).toHaveLength(1);
    expect(listed.summary).toEqual({
      total: 2,
      statusCounts: { DRAFT: 1, FINALIZED: 0, PAID: 1 },
      amounts: {
        grossIncome: 44000000,
        totalDeductions: 5858000,
        netIncome: 38142000,
        unpaidNetIncome: 19071000,
        paidNetIncome: 19071000,
      },
    });
  });

  test('returns a complete zero summary when the payroll period does not exist', async () => {
    const listed = await service.listPayrollResults(
      { month: 8, year: 2026, page: 1, limit: 20 },
      { permissions: ['HR_PAYROLL:READ'] },
    );

    expect(listed.summary).toEqual({
      total: 0,
      statusCounts: { DRAFT: 0, FINALIZED: 0, PAID: 0 },
      amounts: {
        grossIncome: 0,
        totalDeductions: 0,
        netIncome: 0,
        unpaidNetIncome: 0,
        paidNetIncome: 0,
      },
    });
  });

  test('audits admin payroll amount reads with safe identifiers and filters only', async () => {
    const run = await seedDraftRun();
    const result = await PayrollResult.findOne({ payrollRunId: run._id, profileId: profileOneId }).lean();
    await PayrollAdjustment.create({
      profileId: profileOneId,
      month: 7,
      year: 2026,
      type: 'EARNING',
      code: 'OTHER',
      name: 'Private correction',
      amount: 123456,
      note: 'Private payroll note',
      status: 'APPROVED',
      createdByAccountId: actorId,
      updatedByAccountId: actorId,
    });
    const auth = {
      accountId: String(actorId),
      permissions: ['HR_PAYROLL:READ', 'HR_PAYROLL:WRITE'],
      auditContext: { requestId: 'payroll-sensitive-read' },
    };

    await service.listPayrollResults({ payrollRunId: String(run._id), page: 1, limit: 20 }, auth);
    await service.getPayrollRun(String(run._id), auth);
    await service.getPayrollResult(String(result._id), auth);
    await adjustmentService.listAdjustments({ profileId: String(profileOneId), month: 7, year: 2026 }, auth);

    const audits = await AuditEvent.find({ action: { $in: [
      'HR_PAYROLL_RESULTS_READ',
      'HR_PAYROLL_RUN_DETAIL_READ',
      'HR_PAYROLL_RESULT_READ',
      'HR_PAYROLL_ADJUSTMENTS_READ',
    ] } }).sort({ createdAt: 1 }).lean();
    expect(audits.map(({ action }) => action)).toEqual([
      'HR_PAYROLL_RESULTS_READ',
      'HR_PAYROLL_RUN_DETAIL_READ',
      'HR_PAYROLL_RESULT_READ',
      'HR_PAYROLL_ADJUSTMENTS_READ',
    ]);
    audits.forEach((audit) => {
      expect(audit).toMatchObject({
        actorType: 'ACCOUNT', actorAccountId: actorId, source: 'HTTP', requestId: 'payroll-sensitive-read',
      });
      expect(JSON.stringify(audit.metadata)).not.toMatch(/123456|19071000|22000000|2929000|Private payroll note/);
    });
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

  test('audit failure rolls back a live payroll run and results so retry can succeed', async () => {
    const auditSpy = jest.spyOn(auditPublic, 'record').mockRejectedValueOnce(new Error('forced payroll audit failure'));

    try {
      await expect(service.calculatePayroll(
        { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
        { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
      )).rejects.toThrow('forced payroll audit failure');
      expect(await Promise.all([
        PayrollRun.countDocuments({}), PayrollResult.countDocuments({}), AuditEvent.countDocuments({}),
      ])).toEqual([0, 0, 0]);

      const retried = await service.calculatePayroll(
        { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
        { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
      );
      expect(retried).toMatchObject({ status: 'DRAFT', resultCount: 1 });
      expect(await Promise.all([
        PayrollRun.countDocuments({}), PayrollResult.countDocuments({}),
        AuditEvent.countDocuments({ action: 'HR_PAYROLL_RUN_CREATED' }),
      ])).toEqual([1, 1, 1]);
    } finally {
      auditSpy.mockRestore();
    }
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

  test('paid audit failure rolls back only that result and the batch continues', async () => {
    const run = await seedDraftRun();
    await service.finalizePayroll({ payrollRunId: String(run._id), expectedVersion: 0 }, { accountId: String(actorId) });
    const results = await PayrollResult.find({ payrollRunId: run._id }).sort({ profileId: 1 }).lean();
    const auditSpy = jest.spyOn(auditPublic, 'record').mockRejectedValueOnce(new Error('forced paid audit failure'));

    try {
      const outcome = await service.markPayrollPaid({
        payrollRunId: String(run._id),
        payrollResultIds: results.map((result) => String(result._id)),
        expectedVersion: 1,
      }, { accountId: String(actorId) });

      expect(outcome.results).toEqual([
        { payrollResultId: String(results[0]._id), success: false, code: 'AUDIT_FAILED' },
        { payrollResultId: String(results[1]._id), success: true, status: 'PAID', version: 2 },
      ]);
      expect((await PayrollResult.find({ payrollRunId: run._id }).sort({ profileId: 1 }).lean())
        .map(({ status }) => status)).toEqual(['FINALIZED', 'PAID']);
      expect((await PayrollRun.findById(run._id).lean()).status).toBe('FINALIZED');
    } finally {
      auditSpy.mockRestore();
    }
  });

  test('paid notification failure leaves a successful result committed', async () => {
    const run = await seedDraftRun();
    await service.finalizePayroll({ payrollRunId: String(run._id), expectedVersion: 0 }, { accountId: String(actorId) });
    const result = await PayrollResult.findOne({ payrollRunId: run._id }).lean();
    const notificationSpy = jest.spyOn(notificationPublic, 'notify')
      .mockRejectedValueOnce(new Error('forced paid notification failure'));

    try {
      const outcome = await service.markPayrollPaid({
        payrollRunId: String(run._id), payrollResultIds: [String(result._id)], expectedVersion: 1,
      }, { accountId: String(actorId) });

      expect(outcome.results).toEqual([
        { payrollResultId: String(result._id), success: true, status: 'PAID', version: 2 },
      ]);
      expect(await PayrollResult.findById(result._id).lean()).toMatchObject({ status: 'PAID', version: 2 });
      expect(await AuditEvent.countDocuments({ entityId: String(result._id), action: 'PAID' })).toBe(1);
    } finally {
      notificationSpy.mockRestore();
    }
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

    expect([afterCreate.netIncome, afterUpdate.netIncome, afterCancel.netIncome]).toEqual([
      initial.netIncome + 100000,
      initial.netIncome + 120000,
      initial.netIncome,
    ]);
    expect(afterCreate.inputSnapshot.adjustments).toHaveLength(1);
    expect(afterUpdate.inputSnapshot.adjustments[0].amount).toBe(120000);
    expect(afterCancel.inputSnapshot.adjustments).toEqual([]);
    expect([created.requiresReview, updated.requiresReview, cancelled.requiresReview]).toEqual([false, false, false]);

    await service.finalizePayroll({ payrollRunId: run.id, expectedVersion: 0 }, { accountId: String(actorId) });
    const finalized = await PayrollResult.findById(initial._id).lean();
    await expect(adjustmentService.createAdjustment({
      profileId: String(profileOneId), month: 7, year: 2026, type: 'EARNING',
      code: 'ARREARS', name: 'Later correction', amount: 200000, note: 'Locked period',
    }, { accountId: String(actorId) })).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
    expect((await PayrollResult.findById(initial._id).lean()).inputSnapshot).toEqual(finalized.inputSnapshot);
  });

  test('adjustment audit failure rolls back creation and DRAFT payroll refresh', async () => {
    const run = await service.calculatePayroll(
      { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
      { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
    );
    const before = await PayrollResult.findOne({ payrollRunId: run.id, profileId: profileOneId }).lean();
    const auditSpy = jest.spyOn(auditPublic, 'record').mockRejectedValueOnce(new Error('forced adjustment audit failure'));

    try {
      await expect(adjustmentService.createAdjustment({
        profileId: String(profileOneId), month: 7, year: 2026, type: 'EARNING',
        code: 'BONUS', name: 'Rollback bonus', amount: 100000,
      }, { accountId: String(actorId) })).rejects.toThrow('forced adjustment audit failure');
      expect(await PayrollAdjustment.countDocuments({ name: 'Rollback bonus' })).toBe(0);
      expect((await PayrollResult.findById(before._id).lean()).netIncome).toBe(before.netIncome);
    } finally {
      auditSpy.mockRestore();
    }
  });

  test('DRAFT refresh failure rolls back adjustment creation', async () => {
    const run = await service.calculatePayroll(
      { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
      { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
    );
    const before = await PayrollResult.findOne({ payrollRunId: run.id, profileId: profileOneId }).lean();
    const refreshSpy = jest.spyOn(service, 'refreshDraftPayrollResult')
      .mockRejectedValueOnce(new Error('forced draft refresh failure'));

    try {
      await expect(adjustmentService.createAdjustment({
        profileId: String(profileOneId), month: 7, year: 2026, type: 'EARNING',
        code: 'BONUS', name: 'Refresh rollback', amount: 100000,
      }, { accountId: String(actorId) })).rejects.toThrow('forced draft refresh failure');
      expect(await PayrollAdjustment.countDocuments({ name: 'Refresh rollback' })).toBe(0);
      expect((await PayrollResult.findById(before._id).lean()).netIncome).toBe(before.netIncome);
    } finally {
      refreshSpy.mockRestore();
    }
  });

  test('finalized payroll locks adjustment update and cancellation', async () => {
    const run = await service.calculatePayroll(
      { month: 7, year: 2026, profileIds: [String(profileOneId)], shadow: false },
      { accountId: String(actorId), permissions: ['HR_PAYROLL:WRITE'] },
    );
    const adjustment = await adjustmentService.createAdjustment({
      profileId: String(profileOneId), month: 7, year: 2026, type: 'EARNING',
      code: 'BONUS', name: 'Locked bonus', amount: 100000,
    }, { accountId: String(actorId) });
    await service.finalizePayroll({ payrollRunId: run.id, expectedVersion: 0 }, { accountId: String(actorId) });

    await expect(adjustmentService.updateAdjustment(adjustment.id, {
      amount: 120000, expectedVersion: 0,
    }, { accountId: String(actorId) })).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
    await expect(adjustmentService.cancelAdjustment(
      adjustment.id, 0, { accountId: String(actorId) },
    )).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
    expect(await PayrollAdjustment.findById(adjustment.id).lean())
      .toMatchObject({ status: 'APPROVED', amount: 100000, version: 0 });
  });
});
