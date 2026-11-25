const Poll = require('../models/vendorTrackingPoll.model');

const LEASE_MS = 120000;

async function discover(ids, now = new Date(), provider) {
  if (!ids.length) return;
  try {
    await Poll.bulkWrite(ids.map(_id => ({ updateOne: {
      filter: { _id }, update: { ...(provider && { $set: { provider } }), $setOnInsert: { nextCheckAt: now, attempt: 0 } }, upsert: true,
    } })), { ordered: false });
  } catch (error) {
    if (error.code !== 11000 || !error.writeErrors?.every(e => e.code === 11000)) throw error;
  }
  // A reopened shipment may become eligible again after a previous terminal poll.
  await Poll.updateMany({ _id: { $in: ids }, nextCheckAt: null, lastOutcome: 'COMPLETE' },
    { $set: { nextCheckAt: now, lastOutcome: 'REOPENED' } });
}

function eligible(now) {
  return { nextCheckAt: { $type: 'date', $lte: now },
    $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: now } }] };
}

function due(limit, now = new Date(), provider) {
  return Poll.find({ ...eligible(now), ...(provider !== undefined && { provider }) }).sort({ nextCheckAt: 1, _id: 1 }).limit(limit).select('_id').lean();
}

function claim(id, token, now = new Date()) {
  return Poll.findOneAndUpdate({ _id: id, ...eligible(now) }, {
    $set: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  }, { returnDocument: 'after' }).lean();
}

function owned(id, token, now) {
  return { _id: id, leaseToken: token, leaseExpiresAt: { $gt: now } };
}

async function renew(id, token, now = new Date(), session) {
  const result = await Poll.updateOne(owned(id, token, now), {
    $set: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  }, { session });
  return result.matchedCount === 1;
}

async function remember(id, token, pendingUpdate) {
  const result = await Poll.updateOne(owned(id, token, new Date()), { $set: { pendingUpdate } });
  return result.matchedCount === 1;
}

async function finish(id, token, outcome, nextCheckAt, now = new Date(), attempt = 0, clearPending = false) {
  const result = await Poll.updateOne(owned(id, token, now), {
    ...(clearPending && { $unset: { pendingUpdate: 1 } }),
    $set: { lastOutcome: outcome, lastAttemptAt: now, nextCheckAt, attempt, leaseToken: null, leaseExpiresAt: null },
  });
  return result.matchedCount === 1;
}
// Reclaim writes the same poll row. Mongo serializes takeover against the shipment write.
function withOwnedWrite(id, token, mutate) {
  return Poll.db.transaction(async session => {
    if (!await renew(id, token, new Date(), session)) {
      const error = new Error('Vendor tracking poll lease expired');
      error.code = 'TRACKING_LEASE_LOST';
      throw error;
    }
    return mutate(session);
  });
}

module.exports = { discover, due, claim, renew, remember, finish, withOwnedWrite };

async function summarizeByProvider(now = new Date()) {
  return Poll.aggregate([
    { $group: {
      _id: { $ifNull: ['$provider', 'LEGACY'] },
      waiting: { $sum: { $cond: [{ $and: [{ $ne: ['$nextCheckAt', null] }, { $lte: ['$nextCheckAt', now] }, { $lte: [{ $ifNull: ['$leaseExpiresAt', new Date(0)] }, now] }] }, 1, 0] } },
      processing: { $sum: { $cond: [{ $gt: ['$leaseExpiresAt', now] }, 1, 0] } },
      scheduled: { $sum: { $cond: [{ $gt: ['$nextCheckAt', now] }, 1, 0] } },
      completed: { $sum: { $cond: [{ $eq: ['$lastOutcome', 'COMPLETE'] }, 1, 0] } },
      errors: { $sum: { $cond: [{ $in: ['$lastOutcome', ['INVALID_REFERENCE', 'RATE_LIMITED', 'TRANSIENT_FAILURE']] }, 1, 0] } },
      lastAttemptAt: { $max: '$lastAttemptAt' },
    } },
  ]);
}
module.exports.summarizeByProvider = summarizeByProvider;
