const Request = require('../models/financeRecalculationRequest.model');
const Guard = require('../models/financeRecalculationGuard.model');

function request({ orderItemId, importBatchId, reason }, { session, refresh = false } = {}) {
  const filter = { _id: String(orderItemId) };
  if (refresh) Object.assign(filter, { pending: { $ne: true }, failedVersion: null });
  return Request.findOneAndUpdate(filter, {
    $inc: { requestedVersion: 1 },
    $unset: { failedVersion: 1, failedAt: 1, lastError: 1 },
    $set: { pending: true, nextSignalAt: new Date(), reason },
    ...(importBatchId ? { $addToSet: { batchIds: String(importBatchId) } } : {}),
  }, { upsert: true, returnDocument: 'after', session }).lean().catch((error) => {
    // A pending or blocked request with the same item ID already owns this refresh.
    if (refresh && error.code === 11000) return null;
    throw error;
  });
}

function findPending(id, session) {
  return Request.findOne({ _id: id, pending: true }, null, { session }).lean();
}

async function complete(claim, session) {
  const filter = { _id: claim._id, completedVersion: { $lt: claim.requestedVersion } };
  const result = await Request.updateOne(filter, {
    $set: { completedVersion: claim.requestedVersion },
    $pull: { batchIds: { $in: claim.batchIds } },
  }, { session });
  if (!result.modifiedCount) return false;
  await Request.updateOne({ _id: claim._id, requestedVersion: claim.requestedVersion }, {
    $set: { pending: false },
  }, { session });
  return true;
}

function due(limit) {
  return Request.find({ pending: true, nextSignalAt: { $lte: new Date() } })
    .sort({ nextSignalAt: 1, _id: 1 }).limit(limit).lean();
}

function postponeSignal(claim) {
  return Request.updateOne({ _id: claim._id, requestedVersion: claim.requestedVersion }, {
    $set: { nextSignalAt: new Date(Date.now() + 60000) },
  });
}

async function prepareGuard(orderId) {
  try {
    await Guard.updateOne({ _id: String(orderId) }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

function lockOrder(orderId, session) {
  return Guard.updateOne({ _id: String(orderId) }, { $inc: { revision: 1 } }, { session });
}

const checkpointKey = 'missing-snapshot-checkpoint';
async function checkpoint(key = checkpointKey) {
  return (await Guard.findById(key).lean())?.cursor || null;
}
async function advanceCheckpoint(previous, cursor, key = checkpointKey) {
  await prepareGuard(key);
  await Guard.updateOne({ _id: key, cursor: previous }, { $set: { cursor } });
}

function blockFailedVersion(claim, error, session) {
  return Request.updateOne({ _id: claim._id, requestedVersion: claim.requestedVersion }, {
    $set: { pending: false, failedAt: new Date(), failedVersion: claim.requestedVersion, lastError: String(error.message || error).slice(0, 1000) },
    $pull: { batchIds: { $in: claim.batchIds } },
  }, { session });
}

module.exports = { blockFailedVersion, request, findPending, complete, due, postponeSignal, prepareGuard, lockOrder, checkpoint, advanceCheckpoint };
