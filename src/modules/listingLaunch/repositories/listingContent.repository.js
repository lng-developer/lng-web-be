const mongoose = require('mongoose');
const Run = require('../models/listingContentRun.model');
const Version = require('../models/listingContentVersion.model');
const launchRepository = require('./listingLaunch.repository');
const { activeRunStatuses } = require('../constants/listingContent.constants');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');

const conflict = (message) => new AppError(message, 409, true, errorCodes.CONFLICT_ERROR);

function findRunByRequestKey(launchId, requestKey, session = null) {
  return Run.findOne({ launchId, requestKey }).session(session).lean();
}

function findRunById(launchId, runId) {
  return Run.findOne({ _id: runId, launchId }).lean();
}

function replayRun(run, requestHash) {
  if (run.requestHash !== requestHash) throw conflict('Request key was already used for a different command');
  return { run, replayed: true };
}

async function reserveGeneration(payload) {
  const { launchId, requestKey, requestHash, inputVersion, inputSnapshot } = payload;
  try {
    return await mongoose.connection.transaction(async (session) => {
      const previous = await findRunByRequestKey(launchId, requestKey, session);
      if (previous) return replayRun(previous, requestHash);
      const active = await Run.findOne({ launchId, status: { $in: activeRunStatuses } }).session(session).lean();
      if (active) throw conflict('A content generation is already active for this launch');
      const launch = await launchRepository.reserveContentGeneration(launchId, inputVersion, inputSnapshot, session);
      if (!launch) throw conflict('Content inputs changed; reload the listing launch');
      const [run] = await Run.create([{ ...payload, resultVersionId: new mongoose.Types.ObjectId() }], { session });
      return { run: run.toObject(), replayed: false };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await findRunByRequestKey(launchId, requestKey);
    if (winner) return replayRun(winner, requestHash);
    throw conflict('A content generation is already active for this launch');
  }
}

function claimGeneration(runId) {
  const now = new Date();
  return Run.findOneAndUpdate({ _id: runId, status: 'QUEUED' }, {
    $set: { status: 'RUNNING', startedAt: now, leaseExpiresAt: new Date(now.getTime() + 120000), errorCode: null, errorMessage: null },
  }, { returnDocument: 'after', runValidators: true }).lean();
}

function ownedLease(run) {
  return { _id: run._id, status: 'RUNNING', leaseExpiresAt: { $eq: run.leaseExpiresAt, $gt: new Date() } };
}

async function completeGeneration(run, { content, usage, providerRequestId }) {
  return mongoose.connection.transaction(async (session) => {
    const launch = await launchRepository.allocateContentVersion(run.launchId, session);
    if (!launch) throw conflict('Listing launch no longer exists');
    await Version.insertMany([{ _id: run.resultVersionId, launchId: run.launchId, shopId: run.shopId,
      version: launch.contentVersionCounter, source: 'AI', runId: run._id,
      inputVersion: run.inputVersion, inputHash: run.inputHash, profileVersion: run.profileVersion,
      content, createdBy: run.requestedBy }], { session });
    const finished = await Run.findOneAndUpdate(ownedLease(run), {
      $set: { status: 'SUCCEEDED', finishedAt: new Date(), usage, providerRequestId, errorCode: null, errorMessage: null, validationErrors: [] },
    }, { session, returnDocument: 'after', runValidators: true }).lean();
    if (!finished) throw new AppError('Content generation lease expired', 409, true, 'CONTENT_GENERATION_LEASE_EXPIRED');
    return finished;
  });
}

function failGeneration(run, failure) {
  return Run.findOneAndUpdate(ownedLease(run), { $set: { ...failure, status: 'FAILED', finishedAt: new Date() } },
    { returnDocument: 'after', runValidators: true }).lean();
}

function setDispatchError(runId, pending) {
  return Run.findOneAndUpdate({ _id: runId, status: 'QUEUED' }, { $set: {
    errorCode: pending ? 'CONTENT_DISPATCH_PENDING' : null,
    errorMessage: pending ? 'Content generation is queued; dispatch will be retried' : null,
  } }, { returnDocument: 'after', runValidators: true }).lean();
}

function findQueuedGenerations() {
  return Run.find({ status: 'QUEUED' }).sort({ createdAt: 1, _id: 1 }).limit(100).select('_id').lean();
}

async function failExpiredGenerations() {
  const filter = { status: 'RUNNING', leaseExpiresAt: { $lte: new Date() } };
  const expired = await Run.find(filter).sort({ createdAt: 1, _id: 1 }).limit(100).select('_id').lean();
  if (!expired.length) return 0;
  const result = await Run.updateMany({ ...filter, _id: { $in: expired.map(({ _id }) => _id) } }, { $set: {
    status: 'FAILED', finishedAt: new Date(), errorCode: 'WORKER_INTERRUPTED',
    errorMessage: 'Content generation was interrupted; submit a new request to try again', validationErrors: [],
  } }, { runValidators: true });
  return result.modifiedCount;
}

module.exports = { findRunByRequestKey, findRunById, replayRun, reserveGeneration, claimGeneration,
  completeGeneration, failGeneration, setDispatchError, findQueuedGenerations, failExpiredGenerations };
