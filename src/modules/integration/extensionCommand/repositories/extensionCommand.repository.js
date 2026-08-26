const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExtensionAgent = require('../models/extensionAgent.model');
const ExtensionCommand = require('../models/extensionCommand.model');
const ExtensionOrderSchedule = require('../models/extensionOrderSchedule.model');
const { extensionCommandStatuses } = require('../constants/extensionCommand.constants');

async function upsertAgent(payload) {
  return ExtensionAgent.findOneAndUpdate(
    { extensionTokenId: payload.extensionTokenId, clientId: payload.clientId },
    { $set: payload },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

function listAgents({ shopIds, onlineSince }) {
  return ExtensionAgent.find({ ...(shopIds?.length ? { shopId: { $in: shopIds } } : {}), ...(onlineSince ? { lastSeenAt: { $gte: onlineSince } } : {}) })
    .sort({ lastSeenAt: -1, _id: -1 }).lean();
}

function findAgentById(agentId) { return ExtensionAgent.findById(agentId).lean(); }
function findAgentForToken(extensionTokenId, clientId) {
  return ExtensionAgent.findOne({ extensionTokenId, clientId }).lean();
}
async function createCommand(payload) { return (await ExtensionCommand.create(payload)).toObject(); }

async function listCommands({ page, limit, shopIds }) {
  const filter = { shopId: { $in: shopIds } };
  const [items, total] = await Promise.all([
    ExtensionCommand.find(filter).sort({ createdAt: -1, _id: -1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    ExtensionCommand.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function releaseExpired(agentId, now) {
  return ExtensionCommand.updateMany(
    { agentId, status: { $in: [extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING] }, leaseExpiresAt: { $lte: now } },
    { $set: { status: extensionCommandStatuses.QUEUED, claimedAt: null, startedAt: null, leaseExpiresAt: null, leaseTokenHash: null } },
  );
}

function claimNext({ agentId, leaseTokenHash, now, leaseExpiresAt }) {
  return ExtensionCommand.findOneAndUpdate(
    { agentId, status: extensionCommandStatuses.QUEUED },
    { $set: { status: extensionCommandStatuses.CLAIMED, claimedAt: now, leaseExpiresAt, leaseTokenHash }, $inc: { attemptCount: 1 } },
    { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after', runValidators: true },
  ).select('+leaseTokenHash').lean();
}

function updateClaimed({ commandId, agentId, leaseTokenHash, patch, unset, statuses }) {
  return ExtensionCommand.findOneAndUpdate(
    { _id: commandId, agentId, leaseTokenHash, status: { $in: statuses }, leaseExpiresAt: { $gt: new Date() } },
    { $set: patch, ...(unset ? { $unset: unset } : {}) }, { returnDocument: 'after', runValidators: true },
  ).lean();
}

function listDueOrderSchedules(now) {
  return ExtensionOrderSchedule.find({ enabled: true, nextRunAt: { $lte: now } })
    .populate({ path: 'agentId', select: 'lastSeenAt' })
    .lean();
}

async function claimDueOrderSchedule(scheduleId, now, intervalMinutes) {
  const result = await ExtensionOrderSchedule.updateOne(
    { _id: scheduleId, enabled: true, nextRunAt: { $lte: now } },
    { $set: { nextRunAt: new Date(now.getTime() + (intervalMinutes * 60 * 1000)), lastError: null } },
  );
  return result.modifiedCount === 1;
}

function hasActiveOrderCommand(agentId) {
  return ExtensionCommand.exists({
    agentId,
    type: 'IMPORT_NEW_ORDERS',
    status: { $in: [extensionCommandStatuses.QUEUED, extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING] },
  });
}

function postponeOrderSchedule(scheduleId, now, lastError) {
  return ExtensionOrderSchedule.updateOne(
    { _id: scheduleId, enabled: true },
    { $set: { nextRunAt: new Date(now.getTime() + (15 * 60 * 1000)), lastError } },
  );
}

function markOrderScheduleQueued(scheduleId, now) {
  return ExtensionOrderSchedule.updateOne(
    { _id: scheduleId },
    { $set: { lastQueuedAt: now, lastError: null } },
  );
}

function listOrderSchedules({ shopIds }) {
  return ExtensionOrderSchedule.find({ shopId: { $in: shopIds } }).sort({ updatedAt: -1, _id: -1 }).lean();
}

function findOrderScheduleByAgentId(agentId) {
  return ExtensionOrderSchedule.findOne({ agentId }).lean();
}

function upsertOrderSchedule({ shopId, agentId, enabled, intervalMinutes, now, runImmediately = false }) {
  return ExtensionOrderSchedule.findOneAndUpdate(
    { agentId },
    { $set: { shopId, enabled, intervalMinutes, nextRunAt: new Date(now.getTime() + (enabled && !runImmediately ? intervalMinutes : 0) * 60 * 1000), lastError: null } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { upsertAgent, listAgents, findAgentById, findAgentForToken, createCommand, listCommands, releaseExpired, claimNext, updateClaimed, listDueOrderSchedules, claimDueOrderSchedule, hasActiveOrderCommand, postponeOrderSchedule, markOrderScheduleQueued, listOrderSchedules, findOrderScheduleByAgentId, upsertOrderSchedule };
