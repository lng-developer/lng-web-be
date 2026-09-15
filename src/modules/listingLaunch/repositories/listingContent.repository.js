const mongoose = require('mongoose');
const Run = require('../models/listingContentRun.model');
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

module.exports = { findRunByRequestKey, findRunById, replayRun, reserveGeneration };
