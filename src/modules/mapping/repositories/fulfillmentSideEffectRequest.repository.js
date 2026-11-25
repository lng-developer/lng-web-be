const Model = require('../models/fulfillmentSideEffectRequest.model');

function due(now = new Date()) {
  return { blocked: false, nextAttemptAt: { $lte: now },
    $expr: { $gt: ['$requestedVersion', '$completedVersion'] },
    $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: now } }] };
}

async function request({ orderId, orderItemId, markReady, triggerProduction, authContext = {} }) {
  const itemKey = `items.${orderItemId}`;
  const patch = { nextAttemptAt: new Date(), blocked: false, attempts: 0, lastErrorCode: null,
    [`${itemKey}.orderItemId`]: String(orderItemId), [`${itemKey}.authContext`]: authContext,
    [`${itemKey}.markReady`]: Boolean(markReady), [`${itemKey}.triggerProduction`]: Boolean(triggerProduction) };
  const update = { $inc: { requestedVersion: 1 }, $set: patch, $setOnInsert: { orderId, completedVersion: 0 } };
  try {
    return await Model.findOneAndUpdate({ orderId }, update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: false }).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Model.findOneAndUpdate({ orderId }, update, { returnDocument: 'after' }).lean();
  }
}

function claim(orderId, leaseToken, leaseMs) {
  return Model.findOneAndUpdate({ orderId, ...due() }, { $set: {
    leaseToken, leaseExpiresAt: new Date(Date.now() + leaseMs),
  } }, { returnDocument: 'after' }).lean();
}

function owned(orderId, leaseToken) {
  return { orderId, leaseToken, leaseExpiresAt: { $gt: new Date() } };
}

async function renew(orderId, leaseToken, leaseMs) {
  const result = await Model.updateOne(owned(orderId, leaseToken), {
    $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
  });
  return result.matchedCount === 1;
}

async function complete(orderId, leaseToken, version) {
  const result = await Model.updateOne({ ...owned(orderId, leaseToken), requestedVersion: version }, {
    $set: { completedVersion: version, items: {}, leaseToken: null, leaseExpiresAt: null, attempts: 0, lastErrorCode: null },
  });
  if (result.matchedCount) return true;
  await Model.updateOne(owned(orderId, leaseToken), { $set: { leaseToken: null, leaseExpiresAt: null } });
  return false;
}

async function fail(orderId, leaseToken, version, code, nextAttemptAt) {
  await Model.updateOne({ ...owned(orderId, leaseToken), requestedVersion: version }, {
    $inc: { attempts: 1 }, $set: { lastErrorCode: code, nextAttemptAt },
  });
  await Model.updateOne({ ...owned(orderId, leaseToken), requestedVersion: version, attempts: { $gte: 3 } }, { $set: { blocked: true } });
  await Model.updateOne(owned(orderId, leaseToken), { $set: { leaseToken: null, leaseExpiresAt: null } });
}

function listDue(limit = 100) {
  return Model.find(due()).sort({ nextAttemptAt: 1, _id: 1 }).limit(limit).select('orderId requestedVersion').lean();
}

module.exports = { request, claim, renew, complete, fail, listDue };
