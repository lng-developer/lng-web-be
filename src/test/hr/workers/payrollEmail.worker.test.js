const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}), { virtual: true });
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  listByAccountIds: jest.fn(async (accountIds) => accountIds.map((accountId) => ({
    accountId: String(accountId), workEmail: `${String(accountId).slice(-4)}@lng.co`,
  }))),
}));

const PayrollEmailJob = require('../../../modules/hr/models/payrollEmailJob.model');
const PayrollResult = require('../../../modules/hr/models/payrollResult.model');
const PayrollRun = require('../../../modules/hr/models/payrollRun.model');
const emailService = require('../../../modules/hr/services/payrollEmail.service');
const { processPayrollEmailJob } = require('../../../modules/hr/workers/payrollEmail.worker');

let mongo;
jest.setTimeout(120000);

function resultPayload(runId, profileId, accountId) {
  return {
    payrollRunId: runId,
    profileId,
    accountId,
    employeeSnapshot: { employeeCode: 'MAIL-1', fullName: 'Mail One' },
    formulaVersion: 'legacy-v1', inputSnapshot: {}, standardWorkDays: 22, workUnits: 22,
    salaryFromWork: 1000, overtimePay: 0, totalAllowances: 0, adjustmentEarnings: 0,
    adjustmentDeductions: 0, grossIncome: 1000,
    insurance: { social: 0, health: 0, unemployment: 0, total: 0 },
    personalIncomeTax: 0, totalDeductions: 0, netIncome: 1000,
    status: 'FINALIZED', version: 1, finalizedAt: new Date(),
  };
}

async function seedRun() {
  const actorId = new mongoose.Types.ObjectId();
  const run = await PayrollRun.create({
    month: 7, year: 2026, formulaVersion: 'legacy-v1', status: 'FINALIZED', version: 1,
    resultCount: 1, createdByAccountId: actorId, finalizedByAccountId: actorId, finalizedAt: new Date(),
  });
  const result = await PayrollResult.create(resultPayload(
    run._id, new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(),
  ));
  return { run, result };
}

describe('payroll email persisted jobs', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { dbName: 'task7_payroll_email_test' } });
    await mongoose.connect(mongo.getUri('task7_payroll_email_test'));
    await Promise.all([PayrollEmailJob.init(), PayrollRun.init(), PayrollResult.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    mockSendMail.mockReset();
    await Promise.all([PayrollEmailJob.deleteMany({}), PayrollResult.deleteMany({}), PayrollRun.deleteMany({})]);
  });

  test('replaying payroll:<runId>:<resultId>:email persists and sends only one job', async () => {
    const { run, result } = await seedRun();
    const enqueue = jest.fn(async () => undefined);
    const first = await emailService.queuePayrollEmails(String(run._id), { accountId: String(run.createdByAccountId) }, { enqueue });
    const replay = await emailService.queuePayrollEmails(String(run._id), { accountId: String(run.createdByAccountId) }, { enqueue });
    const [job] = await PayrollEmailJob.find({}).lean();

    expect(first).toEqual({ queued: 1, reused: 0, skipped: 0, jobs: [expect.objectContaining({ status: 'PENDING' })] });
    expect(replay).toEqual({ queued: 0, reused: 1, skipped: 0, jobs: [expect.objectContaining({ id: String(job._id), status: 'PENDING' })] });
    expect(await PayrollEmailJob.countDocuments({ deduplicationKey: `payroll:${run._id}:${result._id}:email` })).toBe(1);

    mockSendMail.mockResolvedValue({ messageId: 'smtp-message-1' });
    await processPayrollEmailJob({ data: { jobId: String(job._id) } });
    await processPayrollEmailJob({ data: { jobId: String(job._id) } });

    await expect(PayrollEmailJob.findById(job._id).lean()).resolves.toMatchObject({
      status: 'SENT', attemptCount: 1, providerMessageId: 'smtp-message-1', lastErrorCode: null,
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  test('a failed persisted job can be retried without losing its attempt history', async () => {
    const { run } = await seedRun();
    await emailService.queuePayrollEmails(String(run._id), { accountId: String(run.createdByAccountId) }, { enqueue: async () => undefined });
    const job = await PayrollEmailJob.findOne({}).lean();
    mockSendMail.mockRejectedValueOnce(Object.assign(new Error('mailbox unavailable'), { code: 'EENVELOPE' }));

    await expect(processPayrollEmailJob({ data: { jobId: String(job._id) } })).rejects.toMatchObject({ code: 'EENVELOPE' });
    await expect(PayrollEmailJob.findById(job._id).lean()).resolves.toMatchObject({
      status: 'FAILED', attemptCount: 1, lastErrorCode: 'EENVELOPE',
    });

    mockSendMail.mockResolvedValueOnce({ messageId: 'smtp-message-2' });
    await processPayrollEmailJob({ data: { jobId: String(job._id) } });
    await expect(PayrollEmailJob.findById(job._id).lean()).resolves.toMatchObject({
      status: 'SENT', attemptCount: 2, providerMessageId: 'smtp-message-2', lastErrorCode: null,
    });
  });

  test('a crash-like stale PROCESSING job is durably reclaimed and sent once', async () => {
    const { run } = await seedRun();
    await emailService.queuePayrollEmails(String(run._id), { accountId: String(run.createdByAccountId) }, { enqueue: async () => undefined });
    const job = await PayrollEmailJob.findOne({}).lean();
    await PayrollEmailJob.updateOne({ _id: job._id }, {
      $set: { status: 'PROCESSING', processingAt: new Date('2026-07-27T00:00:00.000Z') },
      $inc: { attemptCount: 1 },
    });
    mockSendMail.mockResolvedValue({ messageId: 'smtp-recovered' });

    const recovered = await emailService.recoverStalePayrollEmailJobs({
      now: new Date('2026-07-27T00:11:00.000Z'),
      enqueue: async (staleJob) => processPayrollEmailJob({ data: { jobId: String(staleJob._id) } }),
    });
    await emailService.recoverStalePayrollEmailJobs({
      now: new Date('2026-07-27T00:12:00.000Z'),
      enqueue: async (staleJob) => processPayrollEmailJob({ data: { jobId: String(staleJob._id) } }),
    });

    expect(recovered).toEqual({ recovered: 1, queued: 1 });
    await expect(PayrollEmailJob.findById(job._id).lean()).resolves.toMatchObject({
      status: 'SENT', attemptCount: 2, providerMessageId: 'smtp-recovered', lastErrorCode: null,
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
