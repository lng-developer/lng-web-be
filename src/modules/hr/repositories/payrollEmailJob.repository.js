const PayrollEmailJob = require('../models/payrollEmailJob.model');

async function createOrFind(payload) {
  try {
    return { job: (await PayrollEmailJob.create(payload)).toObject(), created: true };
  } catch (error) {
    if (error.code !== 11000) throw error;
    return {
      job: await PayrollEmailJob.findOne({
        payrollRunId: payload.payrollRunId,
        payrollResultId: payload.payrollResultId,
      }).lean(),
      created: false,
    };
  }
}

async function findById(id) {
  return PayrollEmailJob.findById(id).lean();
}

async function claim(id, occurredAt) {
  const staleBefore = new Date(occurredAt.getTime() - 10 * 60_000);
  return PayrollEmailJob.findOneAndUpdate(
    {
      _id: id,
      $or: [
        { status: { $in: ['PENDING', 'FAILED'] } },
        { status: 'PROCESSING', processingAt: { $lte: staleBefore } },
      ],
    },
    {
      $set: { status: 'PROCESSING', processingAt: occurredAt, lastErrorCode: null },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function markSent(id, providerMessageId, occurredAt) {
  return PayrollEmailJob.findOneAndUpdate(
    { _id: id, status: 'PROCESSING' },
    { $set: { status: 'SENT', providerMessageId, sentAt: occurredAt, lastErrorCode: null } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function markFailed(id, errorCode) {
  return PayrollEmailJob.findOneAndUpdate(
    { _id: id, status: 'PROCESSING' },
    { $set: { status: 'FAILED', lastErrorCode: errorCode } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function markStaleProcessing(staleBefore) {
  return PayrollEmailJob.updateMany(
    { status: 'PROCESSING', processingAt: { $lte: staleBefore } },
    { $set: { status: 'FAILED', lastErrorCode: 'STALE_PROCESSING' } },
  );
}

async function listStaleRecoveryJobs(limit = 100) {
  return PayrollEmailJob.find({ status: 'FAILED', lastErrorCode: 'STALE_PROCESSING' })
    .sort({ processingAt: 1, _id: 1 })
    .limit(limit)
    .lean();
}

module.exports = {
  claim,
  createOrFind,
  findById,
  listStaleRecoveryJobs,
  markFailed,
  markSent,
  markStaleProcessing,
};
