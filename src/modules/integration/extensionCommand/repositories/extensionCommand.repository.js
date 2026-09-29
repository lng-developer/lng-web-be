const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExtensionAgent = require('../models/extensionAgent.model');
const ExtensionCommand = require('../models/extensionCommand.model');
const ExtensionOrderSchedule = require('../models/extensionOrderSchedule.model');
const ExtensionFinanceSchedule = require('../models/extensionFinanceSchedule.model');
const { extensionCommandStatuses, extensionCommandTypes } = require('../constants/extensionCommand.constants');

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
function deleteCommand(id) { return ExtensionCommand.deleteOne({ _id: id }); }
function findCommandById(id) { return ExtensionCommand.findById(id).select('+leaseTokenHash').lean(); }

async function listCommands({ page, limit, shopIds, agentId }) {
  const filter = { shopId: { $in: shopIds }, ...(agentId ? { agentId } : {}) };
  const [items, total] = await Promise.all([
    ExtensionCommand.find(filter).sort({ createdAt: -1, _id: -1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    ExtensionCommand.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function releaseExpired(agentId, now) {
  return Promise.all([
    ExtensionCommand.updateMany(
      { agentId, status: extensionCommandStatuses.CLAIMED, leaseExpiresAt: { $lte: now } },
      { $set: { status: extensionCommandStatuses.QUEUED, claimedAt: null, startedAt: null, leaseExpiresAt: null, leaseTokenHash: null } },
    ),
    ExtensionCommand.updateMany(
      { agentId, status: extensionCommandStatuses.RUNNING, leaseExpiresAt: { $lte: now } },
      { $set: { status: extensionCommandStatuses.FAILED, completedAt: now, leaseExpiresAt: null, leaseTokenHash: null, errorMessage: 'Extension lease expired' }, $unset: { activeOrderKey: 1 } },
    ),
  ]);
}

function claimNext({ agentId, leaseTokenHash, now, leaseExpiresAt, listingImageSync = false }) {
  return ExtensionCommand.findOneAndUpdate(
    { agentId, status: { $in: [extensionCommandStatuses.QUEUED, extensionCommandStatuses.WAITING_AMAZON] }, ...(!listingImageSync ? { type: { $ne: extensionCommandTypes.SYNC_LISTING_IMAGES } } : {}) },
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

function hasActiveImportCommand(agentId) {
  return ExtensionCommand.exists({
    agentId,
    type: { $in: Object.values(extensionCommandTypes).filter((type) => type !== extensionCommandTypes.TEST_CONNECTION) },
    status: { $in: [extensionCommandStatuses.QUEUED, extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING] },
  });
}

function listDueFinanceSchedules(now) {
  return ExtensionFinanceSchedule.find({ enabled: true, nextRunAt: { $lte: now } }).lean();
}

async function claimDueFinanceSchedule(scheduleId, now) {
  const result = await ExtensionFinanceSchedule.updateOne(
    { _id: scheduleId, enabled: true, nextRunAt: { $lte: now } },
    { $set: { nextRunAt: new Date(now.getTime() + (24 * 60 * 60 * 1000)), lastError: null } },
  );
  return result.modifiedCount === 1;
}

function listFinanceSchedules({ shopIds }) {
  return ExtensionFinanceSchedule.find({ shopId: { $in: shopIds } }).sort({ updatedAt: -1, _id: -1 }).lean();
}

function findFinanceSchedule({ agentId, source }) {
  return ExtensionFinanceSchedule.findOne({ agentId, source }).lean();
}

async function requestFinanceScheduleNow(scheduleId, now) {
  const result = await ExtensionFinanceSchedule.updateOne(
    { _id: scheduleId, enabled: true },
    { $set: { nextRunAt: now, lastError: null } },
  );
  return result.modifiedCount === 1;
}

function upsertFinanceSchedule({ shopId, agentId, source, enabled, now, runImmediately = false }) {
  return ExtensionFinanceSchedule.findOneAndUpdate(
    { agentId, source },
    { $set: { shopId, enabled, nextRunAt: new Date(now.getTime() + (enabled && !runImmediately ? 24 * 60 * 60 * 1000 : 0)), lastError: null } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

function postponeFinanceSchedule(scheduleId, now, lastError) {
  return ExtensionFinanceSchedule.updateOne(
    { _id: scheduleId, enabled: true },
    { $set: { nextRunAt: new Date(now.getTime() + (15 * 60 * 1000)), lastError } },
  );
}

function markFinanceScheduleQueued(scheduleId, now, backfillStartDate = null) {
  return ExtensionFinanceSchedule.updateOne(
    { _id: scheduleId },
    { $set: { lastQueuedAt: now, lastError: null, ...(backfillStartDate ? { backfillStartDate } : {}) } },
  );
}

function markFinanceScheduleCompleted({ agentId, source, now, success, errorMessage, lastSuccessfulDate, nextRunAt }) {
  return ExtensionFinanceSchedule.updateOne(
    { agentId, source },
    {
      $set: {
        lastCompletedAt: now,
        lastError: success ? null : (errorMessage || 'Extension task failed'),
        ...(nextRunAt ? { nextRunAt } : {}),
        ...(success && lastSuccessfulDate ? { lastSuccessfulDate } : {}),
      },
    },
  );
}

module.exports = { findCommandById, upsertAgent, listAgents, findAgentById, findAgentForToken, createCommand, deleteCommand, listCommands, releaseExpired, claimNext, updateClaimed, listDueOrderSchedules, claimDueOrderSchedule, hasActiveOrderCommand, hasActiveImportCommand, postponeOrderSchedule, markOrderScheduleQueued, listOrderSchedules, findOrderScheduleByAgentId, upsertOrderSchedule, listDueFinanceSchedules, claimDueFinanceSchedule, listFinanceSchedules, findFinanceSchedule, requestFinanceScheduleNow, upsertFinanceSchedule, postponeFinanceSchedule, markFinanceScheduleQueued, markFinanceScheduleCompleted };
