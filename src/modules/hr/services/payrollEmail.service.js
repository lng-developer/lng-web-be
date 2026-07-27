const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { createQueue } = require('../../../config/queue');
const authPublic = require('../../auth/public');
const payrollRepository = require('../repositories/payroll.repository');
const repository = require('../repositories/payrollEmailJob.repository');

const QUEUE_NAME = 'hr-payroll-email';
let queue;

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toJobDto(job) {
  if (!job) return null;
  return {
    id: toId(job),
    payrollRunId: toId(job.payrollRunId),
    payrollResultId: toId(job.payrollResultId),
    status: job.status,
    attemptCount: job.attemptCount || 0,
    lastErrorCode: job.lastErrorCode || null,
    sentAt: job.sentAt || null,
  };
}

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function enqueueEmailJob(job) {
  const delay = Math.max(0, Number.parseInt(process.env.HR_PAYROLL_EMAIL_DELAY_MS || '600', 10) || 0);
  return getQueue().add('send-payroll-email', { jobId: toId(job) }, {
    jobId: `${toId(job)}-${job.attemptCount || 0}`,
    attempts: 3,
    backoff: { type: 'fixed', delay },
    removeOnComplete: 1000,
    removeOnFail: true,
  });
}

async function recoverStalePayrollEmailJobs({ now = new Date(), enqueue = enqueueEmailJob } = {}) {
  const staleMs = Math.max(60_000, Number.parseInt(process.env.HR_PAYROLL_EMAIL_STALE_MS || '600000', 10) || 600_000);
  const staleBefore = new Date(now.getTime() - staleMs);
  const result = await repository.markStaleProcessing(staleBefore);
  const jobs = await repository.listStaleRecoveryJobs();
  for (const job of jobs) await enqueue(job);
  return { recovered: result.modifiedCount || 0, queued: jobs.length };
}

async function queuePayrollEmails(payrollRunId, authContext = {}, dependencies = {}) {
  const run = await payrollRepository.findRunById(payrollRunId);
  if (!run) throw new AppError('Payroll run not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  if (run.status === 'DRAFT') {
    throw new AppError('Finalize payroll before email delivery', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }
  const results = (await payrollRepository.listResultsByRun(payrollRunId))
    .filter((result) => ['FINALIZED', 'PAID'].includes(result.status));
  const profiles = await authPublic.listProfilesByAccountIds(results.map(({ accountId }) => accountId));
  const emailByAccountId = new Map(profiles.map((profile) => [String(profile.accountId), profile.email]));
  const enqueue = dependencies.enqueue || enqueueEmailJob;
  const summary = { queued: 0, reused: 0, skipped: 0, jobs: [] };

  for (const result of results) {
    const recipientEmail = emailByAccountId.get(String(result.accountId));
    if (!recipientEmail) {
      summary.skipped += 1;
      continue;
    }
    const { job, created } = await repository.createOrFind({
      payrollRunId,
      payrollResultId: result._id,
      profileId: result.profileId,
      recipientAccountId: result.accountId,
      recipientEmail,
      requestedByAccountId: authContext.accountId,
      deduplicationKey: `payroll:${payrollRunId}:${result._id}:email`,
    });
    if (created) summary.queued += 1;
    else summary.reused += 1;
    if (job.status !== 'SENT') await enqueue(job);
    summary.jobs.push(toJobDto(job));
  }
  return summary;
}

module.exports = {
  QUEUE_NAME,
  enqueueEmailJob,
  getQueue,
  queuePayrollEmails,
  recoverStalePayrollEmailJobs,
  toJobDto,
};
