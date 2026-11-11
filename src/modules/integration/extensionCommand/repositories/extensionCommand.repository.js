const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExtensionAgent = require('../models/extensionAgent.model');
const ExtensionCommand = require('../models/extensionCommand.model');
const ExtensionOrderSchedule = require('../models/extensionOrderSchedule.model');
const ExtensionFinanceSchedule = require('../models/extensionFinanceSchedule.model');
const ExtensionTrackingSchedule = require('../models/extensionTrackingSchedule.model');
const { extensionCommandStatuses, extensionCommandTypes } = require('../constants/extensionCommand.constants');
const { calculateNextRunAt } = require('../services/scheduleTimeUtils');

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
function findCommandById(id) { return ExtensionCommand.findById(id).select('+leaseTokenHash').lean(); }

async function listCommands({ page, limit, shopIds, agentId }) {
  const filter = { shopId: { $in: shopIds }, ...(agentId ? { agentId } : {}) };
  const [items, total] = await Promise.all([
    ExtensionCommand.find(filter).sort({ createdAt: -1, _id: -1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    ExtensionCommand.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function releaseExpired(agentId, now, provider) {
  if (provider === 'ETSY') return ExtensionCommand.updateMany(
    { agentId, status: { $in: [extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING] }, leaseExpiresAt: { $lte: now } },
    { $set: { status: extensionCommandStatuses.FAILED, completedAt: now, leaseExpiresAt: null, leaseTokenHash: null, errorMessage: 'Extension lease expired' }, $unset: { activeOrderKey: 1 } },
  );
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

function claimNext({ agentId, provider, leaseTokenHash, now, leaseExpiresAt, listingImageSync = false }) {
  return ExtensionCommand.findOneAndUpdate(
    { agentId, status: extensionCommandStatuses.QUEUED, ...(provider === 'ETSY'
      ? {
        provider: 'ETSY',
        $or: [
          { type: extensionCommandTypes.IMPORT_NEW_ORDERS, origin: 'WEB', maxOrders: { $gte: 1, $lte: 200, $mod: [1, 0] } },
          { type: extensionCommandTypes.IMPORT_NEW_ORDERS, origin: 'SCHEDULE' },
          { type: extensionCommandTypes.IMPORT_ADS_SPEND },
          { type: extensionCommandTypes.IMPORT_SETTLEMENTS },
        ],
      }
      : !listingImageSync ? { type: { $ne: extensionCommandTypes.SYNC_LISTING_IMAGES } } : {}) },
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

function findCompletedForLease({ commandId, agentId, leaseTokenHash }) {
  return ExtensionCommand.findOne({ _id: commandId, agentId, provider: 'ETSY', leaseTokenHash, status: { $in: [extensionCommandStatuses.SUCCEEDED, extensionCommandStatuses.FAILED] } }).lean();
}

function listDueOrderSchedules(now) {
  return ExtensionOrderSchedule.find({ enabled: true, nextRunAt: { $lte: now } })
    .populate({ path: 'agentId', select: 'lastSeenAt' })
    .lean();
}

async function claimDueOrderSchedule(scheduleId, now, nextRun) {
  const nextRunAt = nextRun instanceof Date
    ? nextRun
    : new Date(now.getTime() + (Number(nextRun) || 120) * 60 * 1000);
  const result = await ExtensionOrderSchedule.updateOne(
    { _id: scheduleId, enabled: true, nextRunAt: { $lte: now } },
    { $set: { nextRunAt, lastError: null } },
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

function upsertOrderSchedule({
  shopId,
  agentId,
  enabled,
  scheduleType = 'INTERVAL',
  fixedTimes = [],
  timezone = 'Asia/Ho_Chi_Minh',
  intervalMinutes = 120,
  nextRunAt,
  now,
  runImmediately = false,
}) {
  const calculatedNextRun = nextRunAt || calculateNextRunAt({
    scheduleType,
    intervalMinutes,
    fixedTimes,
    timezone,
    now,
  });
  const finalNextRunAt = enabled && runImmediately ? now : calculatedNextRun;

  return ExtensionOrderSchedule.findOneAndUpdate(
    { agentId },
    {
      $set: {
        shopId,
        enabled,
        scheduleType,
        fixedTimes,
        timezone,
        intervalMinutes,
        nextRunAt: finalNextRunAt,
        lastError: null,
      },
    },
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

async function claimDueFinanceSchedule(scheduleId, now, nextRunAt) {
  const result = await ExtensionFinanceSchedule.updateOne(
    { _id: scheduleId, enabled: true, nextRunAt: { $lte: now } },
    { $set: { nextRunAt: nextRunAt || new Date(now.getTime() + (24 * 60 * 60 * 1000)), lastError: null } },
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

function findFinanceScheduleById(id) {
  return ExtensionFinanceSchedule.findById(id).lean();
}

function upsertFinanceSchedule({
  shopId,
  agentId,
  source,
  enabled,
  scheduleType = 'INTERVAL',
  fixedTimes = [],
  timezone = 'Asia/Ho_Chi_Minh',
  intervalMinutes = 1440,
  nextRunAt,
  now,
  runImmediately = false,
}) {
  const calculatedNextRun = nextRunAt || calculateNextRunAt({
    scheduleType,
    intervalMinutes,
    fixedTimes,
    timezone,
    now,
  });
  const finalNextRunAt = enabled && runImmediately ? now : calculatedNextRun;

  return ExtensionFinanceSchedule.findOneAndUpdate(
    { agentId, source },
    {
      $set: {
        shopId,
        enabled,
        scheduleType,
        fixedTimes,
        timezone,
        intervalMinutes,
        nextRunAt: finalNextRunAt,
        lastError: null,
      },
    },
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

async function clearOrphanOrExpiredActiveLock(agentId, now = new Date()) {
  const [finished, expired] = await Promise.all([
    ExtensionCommand.updateMany(
      {
        activeOrderKey: String(agentId),
        status: { $in: [extensionCommandStatuses.SUCCEEDED, extensionCommandStatuses.FAILED] },
      },
      { $unset: { activeOrderKey: 1 } },
    ),
    ExtensionCommand.updateMany(
      {
        agentId,
        status: { $in: [extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING] },
        leaseExpiresAt: { $lte: now },
      },
      {
        $set: {
          status: extensionCommandStatuses.FAILED,
          completedAt: now,
          leaseExpiresAt: null,
          leaseTokenHash: null,
          errorMessage: 'Extension lease expired',
        },
        $unset: { activeOrderKey: 1 },
      },
    ),
  ]);
  return (Number(finished.modifiedCount || 0) + Number(expired.modifiedCount || 0)) > 0;
}

function listDueTrackingSchedules(now) {
  return ExtensionTrackingSchedule.find({ enabled: true, nextRunAt: { $lte: now } })
    .populate({ path: 'agentId', select: 'lastSeenAt' })
    .lean();
}

async function claimDueTrackingSchedule(scheduleId, now, nextRun) {
  const nextRunAt = nextRun instanceof Date
    ? nextRun
    : new Date(now.getTime() + (Number(nextRun) || 120) * 60 * 1000);
  const result = await ExtensionTrackingSchedule.updateOne(
    { _id: scheduleId, enabled: true, nextRunAt: { $lte: now } },
    { $set: { nextRunAt, lastError: null } },
  );
  return result.modifiedCount === 1;
}

function hasActiveTrackingCommand(agentId) {
  return ExtensionCommand.exists({
    agentId,
    type: extensionCommandTypes.UPLOAD_TRACKING,
    status: {
      $in: [
        extensionCommandStatuses.QUEUED,
        extensionCommandStatuses.CLAIMED,
        extensionCommandStatuses.RUNNING,
        'WAITING_AMAZON',
      ],
    },
  });
}

function postponeTrackingSchedule(scheduleId, now, lastError) {
  return ExtensionTrackingSchedule.updateOne(
    { _id: scheduleId, enabled: true },
    { $set: { nextRunAt: new Date(now.getTime() + (15 * 60 * 1000)), lastError } },
  );
}

function markTrackingScheduleQueued(scheduleId, now, { batchCount = 0 } = {}) {
  return ExtensionTrackingSchedule.updateOne(
    { _id: scheduleId },
    { $set: { lastQueuedAt: now, lastBatchCount: batchCount, lastError: null } },
  );
}

function listTrackingSchedules({ shopIds }) {
  return ExtensionTrackingSchedule.find({ shopId: { $in: shopIds } }).sort({ updatedAt: -1, _id: -1 }).lean();
}

function findTrackingScheduleByAgentId(agentId) {
  return ExtensionTrackingSchedule.findOne({ agentId }).lean();
}

function upsertTrackingSchedule({
  shopId,
  agentId,
  enabled,
  scheduleType = 'INTERVAL',
  fixedTimes = [],
  timezone = 'Asia/Ho_Chi_Minh',
  intervalMinutes = 120,
  nextRunAt,
  now,
  runImmediately = false,
}) {
  const calculatedNextRun = nextRunAt || calculateNextRunAt({
    scheduleType,
    intervalMinutes,
    fixedTimes,
    timezone,
    now,
  });
  const finalNextRunAt = enabled && runImmediately ? now : calculatedNextRun;

  return ExtensionTrackingSchedule.findOneAndUpdate(
    { agentId },
    {
      $set: {
        shopId,
        enabled,
        scheduleType,
        fixedTimes: scheduleType === 'FIXED_TIMES' ? fixedTimes : [],
        timezone,
        intervalMinutes: scheduleType === 'INTERVAL' ? intervalMinutes : 120,
        nextRunAt: finalNextRunAt,
        lastError: null,
      },
      $setOnInsert: {
        lastQueuedAt: null,
        lastBatchCount: 0,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}

module.exports = {
  findCompletedForLease,
  findCommandById,
  upsertAgent,
  listAgents,
  findAgentById,
  findAgentForToken,
  createCommand,
  listCommands,
  releaseExpired,
  claimNext,
  updateClaimed,
  listDueOrderSchedules,
  claimDueOrderSchedule,
  hasActiveOrderCommand,
  hasActiveImportCommand,
  postponeOrderSchedule,
  markOrderScheduleQueued,
  listOrderSchedules,
  findOrderScheduleByAgentId,
  upsertOrderSchedule,
  listDueFinanceSchedules,
  claimDueFinanceSchedule,
  listFinanceSchedules,
  findFinanceSchedule,
  findFinanceScheduleById,
  requestFinanceScheduleNow,
  upsertFinanceSchedule,
  postponeFinanceSchedule,
  markFinanceScheduleQueued,
  markFinanceScheduleCompleted,
  clearOrphanOrExpiredActiveLock,
  listDueTrackingSchedules,
  claimDueTrackingSchedule,
  hasActiveTrackingCommand,
  postponeTrackingSchedule,
  markTrackingScheduleQueued,
  listTrackingSchedules,
  findTrackingScheduleByAgentId,
  upsertTrackingSchedule,
};
