const OrderRecheckJob = require('../models/orderRecheckJob.model');

async function create(payload) {
  const job = await OrderRecheckJob.create(payload);
  return job.toObject();
}

async function findById(jobId) {
  return OrderRecheckJob.findById(jobId).lean();
}

async function findActive(activeKey) {
  return OrderRecheckJob.findOne({ activeKey }).lean();
}

async function claim(jobId) {
  return OrderRecheckJob.findOneAndUpdate(
    { _id: jobId, status: 'QUEUED' },
    { $set: { status: 'PROCESSING', startedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean();
}

async function requeueStale(jobId, staleBefore) {
  return OrderRecheckJob.findOneAndUpdate(
    {
      _id: jobId,
      status: 'PROCESSING',
      $or: [{ startedAt: null }, { startedAt: { $lte: staleBefore } }],
    },
    { $set: { status: 'QUEUED', startedAt: null } },
    { returnDocument: 'after' },
  ).lean();
}

async function complete(jobId, result) {
  return OrderRecheckJob.findByIdAndUpdate(jobId, {
    $set: { status: 'COMPLETED', result, finishedAt: new Date(), errorMessage: null },
    $unset: { activeKey: 1 },
  }, { returnDocument: 'after' }).lean();
}

async function fail(jobId, errorMessage) {
  return OrderRecheckJob.findByIdAndUpdate(jobId, {
    $set: { status: 'FAILED', errorMessage, finishedAt: new Date() },
    $unset: { activeKey: 1 },
  }, { returnDocument: 'after' }).lean();
}

module.exports = { create, findById, findActive, claim, requeueStale, complete, fail };
