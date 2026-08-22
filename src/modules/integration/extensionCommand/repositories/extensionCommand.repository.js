const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');
const ExtensionAgent = require('../models/extensionAgent.model');
const ExtensionCommand = require('../models/extensionCommand.model');
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

function updateClaimed({ commandId, agentId, leaseTokenHash, patch, statuses }) {
  return ExtensionCommand.findOneAndUpdate(
    { _id: commandId, agentId, leaseTokenHash, status: { $in: statuses }, leaseExpiresAt: { $gt: new Date() } },
    { $set: patch }, { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { upsertAgent, listAgents, findAgentById, findAgentForToken, createCommand, listCommands, releaseExpired, claimNext, updateClaimed };
