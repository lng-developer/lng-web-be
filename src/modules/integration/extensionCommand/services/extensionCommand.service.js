const AppError = require('../../../../shared/errors/appError');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const { generateRandomToken, hashString } = require('../../../../shared/utils/crypto');
const logger = require('../../../../shared/utils/logger');
const authPublic = require('../../../auth/public');
const repository = require('../repositories/extensionCommand.repository');
const { extensionCommandStatuses } = require('../constants/extensionCommand.constants');
const { toManagementAgentDto } = require('../dtos/extensionCommand.dto');

const LEASE_MS = 5 * 60 * 1000;
const ONLINE_MS = 90 * 1000;
const shopScope = (shopId) => ({ scopeType: 'shop', scopeId: String(shopId) });
const forbidden = () => new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
const notFound = (message) => new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
const conflict = (message) => new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);

function assertUserShopAccess(auth, shopId, permission) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  if (!authPublic.canAccessScope(auth, permission, shopScope(shopId))) throw forbidden();
}
function assertExtension(auth) {
  if (auth?.tokenType !== 'EXTENSION' || !auth.extensionTokenId) throw forbidden();
}
function accessibleShopIds(auth, agents) {
  return [...new Set(agents.filter((agent) => authPublic.canAccessScope(auth, 'ORDERS:READ', shopScope(agent.shopId)) || authPublic.canAccessScope(auth, 'ORDERS:WRITE', shopScope(agent.shopId))).map((agent) => String(agent.shopId)))];
}

async function heartbeat(input, auth) {
  assertExtension(auth);
  const shopId = auth.scopes?.find((scope) => scope.scopeType === 'shop')?.scopeId;
  if (!shopId) throw forbidden();
  const previous = await repository.findAgentForToken(auth.extensionTokenId, input.clientId);
  const now = new Date();
  const offlineForMs = previous?.lastSeenAt ? Date.now() - new Date(previous.lastSeenAt).getTime() : 0;
  const reconnected = offlineForMs > ONLINE_MS;
  const agent = await repository.upsertAgent({ extensionTokenId: auth.extensionTokenId, shopId, clientId: input.clientId, label: input.label, version: input.version || null, apiBaseUrl: input.apiBaseUrl || null, lastSeenAt: now, ...(reconnected ? { lastReconnectedAt: now } : {}) });
  if (reconnected) {
    logger.info('extension_agent_reconnected', { agentId: String(agent._id || agent.id), clientId: input.clientId, shopId: String(shopId), offlineForSeconds: Math.floor(offlineForMs / 1000) });
  }
  return agent;
}

async function listAgents(auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agents = await repository.listAgents({ onlineSince: new Date(Date.now() - ONLINE_MS) });
  return agents.filter((agent) => authPublic.canAccessScope(auth, 'ORDERS:READ', shopScope(agent.shopId)) || authPublic.canAccessScope(auth, 'ORDERS:WRITE', shopScope(agent.shopId)));
}

async function listManagementAgents(auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agents = (await repository.listAgents({})).filter((agent) => authPublic.canAccessScope(auth, 'ORDERS:READ', shopScope(agent.shopId)) || authPublic.canAccessScope(auth, 'ORDERS:WRITE', shopScope(agent.shopId)));
  const tokens = await authPublic.getExtensionTokenMetadataByIds(agents.map((agent) => agent.extensionTokenId));
  const tokenById = new Map(tokens.map((token) => [String(token.id), token]));
  return { items: agents.map((agent) => toManagementAgentDto(agent, tokenById.get(String(agent.extensionTokenId)) || null, Date.now() - new Date(agent.lastSeenAt).getTime() <= ONLINE_MS ? 'ONLINE' : 'OFFLINE')) };
}

async function createCommand(input, auth) {
  assertUserShopAccess(auth, input.shopId, input.type === 'IMPORT_ADS_SPEND' ? 'FINANCE:WRITE' : 'ORDERS:WRITE');
  const agent = await repository.findAgentById(input.agentId);
  if (!agent || String(agent.shopId) !== String(input.shopId)) throw notFound('Extension agent not found for shop');
  return repository.createCommand({ type: input.type, shopId: input.shopId, agentId: input.agentId, numDays: input.numDays, dateFrom: input.dateFrom || null, dateTo: input.dateTo || null, createdByAccountId: auth.accountId || null });
}

async function listCommands(input, auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agents = await repository.listAgents({});
  const shopIds = accessibleShopIds(auth, agents);
  return shopIds.length ? repository.listCommands({ ...input, shopIds }) : { items: [], total: 0, page: input.page, limit: input.limit };
}

async function getCurrentAgent(auth, input) {
  assertExtension(auth);
  const agent = await repository.findAgentForToken(auth.extensionTokenId, input.clientId);
  if (!agent) throw notFound('Extension agent not registered');
  return agent;
}

async function claimNext(input, auth) {
  const agent = await getCurrentAgent(auth, input);
  const now = new Date();
  await repository.releaseExpired(agent._id, now);
  const leaseToken = generateRandomToken(24);
  const command = await repository.claimNext({ agentId: agent._id, leaseTokenHash: hashString(leaseToken), now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) });
  return command ? { command, leaseToken } : null;
}

async function startCommand(commandId, input, auth) {
  const agent = await getCurrentAgent(auth, input);
  const command = await repository.updateClaimed({ commandId, agentId: agent._id, leaseTokenHash: hashString(input.leaseToken), statuses: [extensionCommandStatuses.CLAIMED], patch: { status: extensionCommandStatuses.RUNNING, startedAt: new Date() } });
  if (!command) throw conflict('Command is no longer claimable');
  return command;
}

async function completeCommand(commandId, input, auth) {
  const agent = await getCurrentAgent(auth, input);
  const command = await repository.updateClaimed({
    commandId, agentId: agent._id, leaseTokenHash: hashString(input.leaseToken), statuses: [extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING],
    patch: { status: input.success ? extensionCommandStatuses.SUCCEEDED : extensionCommandStatuses.FAILED, completedAt: new Date(), leaseExpiresAt: null, leaseTokenHash: null, importJobId: input.importJobId || null, result: { importedCount: input.importedCount, failedCount: input.failedCount }, errorMessage: input.success ? null : (input.errorMessage || 'Extension task failed') },
  });
  if (!command) throw conflict('Command is no longer completable');
  return command;
}

module.exports = { heartbeat, listAgents, listManagementAgents, createCommand, listCommands, claimNext, startCommand, completeCommand };
