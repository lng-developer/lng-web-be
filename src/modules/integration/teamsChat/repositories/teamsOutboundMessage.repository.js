const TeamsOutboundMessage = require('../models/teamsOutboundMessage.model');

async function enqueue(data) {
  return TeamsOutboundMessage.findOneAndUpdate({ lngMessageId: data.lngMessageId }, { $setOnInsert: data }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
}
async function claimDue(now = new Date()) {
  const staleLock = new Date(now.getTime() - 60 * 1000);
  return TeamsOutboundMessage.findOneAndUpdate({ $or: [{ status: { $in: ['PENDING', 'RETRY'] }, nextAttemptAt: { $lte: now } }, { status: 'PROCESSING', lockedAt: { $lte: staleLock } }] }, { $set: { status: 'PROCESSING', lockedAt: now }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, returnDocument: 'after' }).lean();
}
async function markSent(id) { return TeamsOutboundMessage.findByIdAndUpdate(id, { $set: { status: 'SENT', sentAt: new Date(), lockedAt: null, lastError: null } }).lean(); }
async function retry(id, nextAttemptAt, lastError) { return TeamsOutboundMessage.findByIdAndUpdate(id, { $set: { status: 'RETRY', nextAttemptAt, lockedAt: null, lastError: String(lastError || '').slice(0, 300) } }).lean(); }
async function fail(id, lastError) { return TeamsOutboundMessage.findByIdAndUpdate(id, { $set: { status: 'FAILED', lockedAt: null, lastError: String(lastError || '').slice(0, 300) } }).lean(); }
module.exports = { enqueue, claimDue, markSent, retry, fail };
