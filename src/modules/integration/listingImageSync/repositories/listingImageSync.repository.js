const mongoose = require('mongoose');
const Job = require('../models/listingImageSyncJob.model');
const Schedule = require('../models/listingImageSyncSchedule.model');

async function createJob({ shopId, agentId, candidates }) {
  return (await Job.create({ shopId, agentId, activeShopKey: String(shopId), items: candidates.map((row) => ({ listingId: row._id, asin: row.asin, marketplaceCode: row.marketplaceCode })) })).toObject();
}
function findJob(id) { return Job.findById(id).lean(); }
async function listJobs({ shopIds, shopId, page = 1, limit = 20 }) {
  const filter = { shopId: shopId ? { $in: shopIds.filter((id) => String(id) === String(shopId)) } : { $in: shopIds } };
  const [items, total] = await Promise.all([Job.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Job.countDocuments(filter)]);
  return { items, total, page, limit };
}
function listActiveJobs() { return Job.find({ status: { $in: ['QUEUED', 'RUNNING'] } }).sort({ createdAt: 1, _id: 1 }).lean(); }
function acquireDispatch(id, token, now) {
  return Job.findOneAndUpdate({ _id: id, status: { $in: ['QUEUED', 'RUNNING'] }, $or: [{ dispatchUntil: null }, { dispatchUntil: { $lte: now } }] },
    { $set: { dispatchToken: token, dispatchUntil: new Date(now.getTime() + 60000) } }, { returnDocument: 'after' }).lean();
}
function releaseDispatch(id, token) { return Job.updateOne({ _id: id, dispatchToken: token }, { $set: { dispatchUntil: null }, $unset: { dispatchToken: 1 } }); }
function reserveBatch(job, token, itemIds) {
  const commandId = new mongoose.Types.ObjectId();
  return Job.findOneAndUpdate({ _id: job._id, dispatchToken: token, batchCommandId: null, status: { $in: ['QUEUED', 'RUNNING'] } },
    { $set: { batchCommandId: commandId, status: 'RUNNING', 'items.$[item].commandId': commandId } },
    { arrayFilters: [{ 'item._id': { $in: itemIds }, 'item.status': 'PENDING' }], returnDocument: 'after' }).lean();
}
function clearBatch(job, token) {
  return Job.findOneAndUpdate({ _id: job._id, batchCommandId: job.batchCommandId, dispatchToken: token },
    { $set: { batchCommandId: null, 'items.$[item].commandId': null, 'items.$[item].resultUntil': null, 'items.$[item].resultToken': null } },
    { arrayFilters: [{ 'item.commandId': job.batchCommandId, 'item.status': 'PENDING' }], returnDocument: 'after' }).lean();
}
function finishJob(id) {
  return Job.findOneAndUpdate({ _id: id, status: { $in: ['QUEUED', 'RUNNING'] }, items: { $not: { $elemMatch: { status: 'PENDING' } } } }, [
    { $set: { status: { $cond: [{ $in: ['FAILED', '$items.status'] }, 'COMPLETED_WITH_ERRORS', 'COMPLETED'] }, activeShopKey: '$$REMOVE', updatedAt: '$$NOW' } },
  ], { returnDocument: 'after', updatePipeline: true }).lean();
}
async function acquireItem(jobId, itemId, commandId, token, until) {
  const result = await Job.updateOne({ _id: jobId, items: { $elemMatch: { _id: itemId, commandId, status: 'PENDING', $or: [{ resultUntil: null }, { resultUntil: { $lte: new Date() } }] } } },
    { $set: { 'items.$.resultToken': token, 'items.$.resultUntil': until } });
  return result.modifiedCount === 1;
}
function releaseItem(jobId, itemId, token) {
  return Job.updateOne({ _id: jobId, items: { $elemMatch: { _id: itemId, resultToken: token } } }, { $set: { 'items.$.resultToken': null, 'items.$.resultUntil': null } });
}
function acknowledge(jobId, itemId, commandId, result, token) {
  return Job.findOneAndUpdate({ _id: jobId, items: { $elemMatch: { _id: itemId, commandId, status: 'PENDING', resultToken: token } } },
    { $set: Object.fromEntries(Object.entries({ ...result, completedAt: new Date() }).map(([key, value]) => [`items.$.${key}`, value])) }, { returnDocument: 'after', runValidators: true }).lean();
}
function changeJob(job, action, errorMessage = null) {
  const filter = { _id: job._id, status: job.status };
  if (action === 'pause') return Job.findOneAndUpdate(filter, { $set: { status: 'PAUSED', errorMessage } }, { returnDocument: 'after' }).lean();
  const patch = { status: 'QUEUED', activeShopKey: String(job.shopId), errorMessage: null };
  if (action === 'retry') {
    filter.items = { $elemMatch: { status: 'FAILED' } };
    return Job.findOneAndUpdate(filter, { $set: { ...patch, 'items.$[item].status': 'PENDING', 'items.$[item].commandId': null, 'items.$[item].errorCode': null, 'items.$[item].errorMessage': null, 'items.$[item].completedAt': null } },
      { arrayFilters: [{ 'item.status': 'FAILED' }], returnDocument: 'after' }).lean();
  }
  return Job.findOneAndUpdate(filter, { $set: patch }, { returnDocument: 'after' }).lean();
}
function listSchedules(shopIds) { return Schedule.find({ shopId: { $in: shopIds } }).sort({ createdAt: 1 }).lean(); }
function upsertSchedule(agent, enabled, now) { return Schedule.findOneAndUpdate({ agentId: agent._id }, { $set: { shopId: agent.shopId, enabled, nextRunAt: now, lastError: null } }, { upsert: true, returnDocument: 'after' }).lean(); }
function dueSchedules(now) { return Schedule.find({ enabled: true, nextRunAt: { $lte: now } }).lean(); }
function claimSchedule(id, now) { return Schedule.findOneAndUpdate({ _id: id, enabled: true, nextRunAt: { $lte: now } }, { $set: { nextRunAt: new Date(now.getTime() + 86400000), lastError: null } }, { returnDocument: 'after' }).lean(); }
function scheduleError(id, message) { return Schedule.updateOne({ _id: id }, { $set: { lastError: message } }); }
module.exports = { acquireItem, releaseItem, createJob, findJob, listJobs, listActiveJobs, acquireDispatch, releaseDispatch, reserveBatch, clearBatch, finishJob, acknowledge, changeJob, listSchedules, upsertSchedule, dueSchedules, claimSchedule, scheduleError };
