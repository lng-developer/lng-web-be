const nodemailer = require('nodemailer');
const { createWorker } = require('../../../config/queue');
const logger = require('../../../shared/utils/logger');
const payrollRepository = require('../repositories/payroll.repository');
const repository = require('../repositories/payrollEmailJob.repository');
const { QUEUE_NAME, toJobDto } = require('../services/payrollEmail.service');

function errorCode(error) {
  return String(error?.code || 'EMAIL_SEND_FAILED').slice(0, 100);
}

function createTransport() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number.parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
}

async function processPayrollEmailJob(bullJob) {
  const jobId = bullJob?.data?.jobId;
  const job = await repository.claim(jobId, new Date());
  if (!job) return toJobDto(await repository.findById(jobId));
  try {
    const run = await payrollRepository.findRunById(job.payrollRunId);
    if (!run) throw Object.assign(new Error('Payroll run not found'), { code: 'PAYROLL_RUN_NOT_FOUND' });
    const from = process.env.PAYROLL_EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@localhost';
    const info = await createTransport().sendMail({
      from,
      to: job.recipientEmail,
      subject: `Payslip ${run.month}/${run.year}`,
      html: `<p>Your payslip for ${run.month}/${run.year} is available in the HR portal.</p>`,
    });
    return toJobDto(await repository.markSent(jobId, info?.messageId || null, new Date()));
  } catch (error) {
    await repository.markFailed(jobId, errorCode(error));
    throw error;
  }
}

async function start() {
  require('dotenv').config();
  const { connectDatabase, disconnectDatabase } = require('../../../config/database');
  await connectDatabase();
  const concurrency = Math.max(1, Number.parseInt(process.env.HR_PAYROLL_EMAIL_CONCURRENCY || '1', 10) || 1);
  const delay = Math.max(0, Number.parseInt(process.env.HR_PAYROLL_EMAIL_DELAY_MS || '600', 10) || 0);
  const worker = createWorker(QUEUE_NAME, processPayrollEmailJob, {
    concurrency,
    ...(delay ? { limiter: { max: 1, duration: delay } } : {}),
  });
  worker.on('failed', (job, error) => logger.error('payroll_email_job_failed', { jobId: job?.id, error }));
  const shutdown = async () => {
    await worker.close();
    await disconnectDatabase();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return worker;
}

if (require.main === module) {
  start().catch((error) => {
    logger.error('payroll_email_worker_start_failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { processPayrollEmailJob, start };
