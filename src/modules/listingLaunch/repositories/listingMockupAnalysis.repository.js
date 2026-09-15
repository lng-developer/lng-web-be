const mongoose = require('mongoose');
const Run = require('../models/listingMockupAnalysisRun.model');
const launches = require('./listingLaunch.repository');
const AppError = require('../../../shared/errors/appError');
const conflict = (code) => new AppError('Mockup analysis request conflicts with current draft', 409, true, code);
const findByRequestKey = (launchId, requestKey, session = null) => Run.findOne({ launchId, requestKey }).session(session).lean();
const findById = (launchId, runId, session = null) => Run.findOne({ launchId, _id: runId }).session(session).lean();
function replayRun(run, requestHash) {
  if (run.requestHash !== requestHash) throw conflict('MOCKUP_REQUEST_CONFLICT');
  return { run, replayed: true };
}
async function reserveAnalysis(payload) {
  const id = new mongoose.Types.ObjectId();
  try {
    return await mongoose.connection.transaction(async session => {
      const previous = await findByRequestKey(payload.launchId, payload.requestKey, session);
      if (previous) return replayRun(previous, payload.requestHash);
      if (await Run.findOne({ launchId: payload.launchId, status: { $in: ['QUEUED', 'RUNNING'] } }).session(session).lean()) throw conflict('MOCKUP_ANALYSIS_ACTIVE');
      const launch = await launches.reserveMockupAnalysis(payload, id, session);
      if (!launch) throw conflict('MOCKUP_INPUT_CHANGED');
      const [run] = await Run.create([{ ...payload, _id: id }], { session });
      return { run: run.toObject(), replayed: false };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const previous = await findByRequestKey(payload.launchId, payload.requestKey);
    if (previous) return replayRun(previous, payload.requestHash);
    throw conflict('MOCKUP_ANALYSIS_ACTIVE');
  }
}
function claimAnalysis(runId) {
  const now = new Date();
  return Run.findOneAndUpdate({ _id: runId, status: 'QUEUED' }, { $set: { status: 'RUNNING', startedAt: now,
    leaseExpiresAt: new Date(now.getTime() + 120000), errorCode: null, errorMessage: null } }, { returnDocument: 'after', runValidators: true }).lean();
}
const lease = run => ({ _id: run._id, status: 'RUNNING', leaseExpiresAt: { $eq: run.leaseExpiresAt, $gt: new Date() } });
function completeAnalysis(run, metadata) {
  return Run.findOneAndUpdate(lease(run), { $set: { ...metadata, status: 'SUCCEEDED', finishedAt: new Date(), errorCode: null, errorMessage: null, validationErrors: [] } }, { returnDocument: 'after', runValidators: true }).lean();
}
function failAnalysis(run, failure) {
  return Run.findOneAndUpdate(lease(run), { $set: { ...failure, status: 'FAILED', finishedAt: new Date() } }, { returnDocument: 'after', runValidators: true }).lean();
}
function setDispatchError(runId, pending) {
  return Run.findOneAndUpdate({ _id: runId, status: 'QUEUED' }, { $set: {
    errorCode: pending ? 'MOCKUP_DISPATCH_PENDING' : null, errorMessage: pending ? 'Analysis is queued; dispatch will be retried' : null,
  } }, { returnDocument: 'after', runValidators: true }).lean();
}
const findQueuedAnalyses = () => Run.find({ status: 'QUEUED' }).sort({ createdAt: 1, _id: 1 }).limit(100).select('_id').lean();
async function failExpiredAnalyses() {
  const filter = { status: 'RUNNING', leaseExpiresAt: { $lte: new Date() } };
  const expired = await Run.find(filter).sort({ createdAt: 1, _id: 1 }).limit(100).select('_id').lean();
  if (!expired.length) return 0;
  const result = await Run.updateMany({ ...filter, _id: { $in: expired.map(x => x._id) } }, { $set: { status: 'FAILED', finishedAt: new Date(),
    errorCode: 'WORKER_INTERRUPTED', errorMessage: 'Analysis was interrupted; submit a new request to try again', validationErrors: [] } }, { runValidators: true });
  return result.modifiedCount;
}
module.exports = { findByRequestKey, findById, replayRun, reserveAnalysis, claimAnalysis, completeAnalysis, failAnalysis, setDispatchError, findQueuedAnalyses, failExpiredAnalyses };
