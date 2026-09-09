const AppError = require('../../../../shared/errors/appError');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const { generateRandomToken, hashString } = require('../../../../shared/utils/crypto');
const logger = require('../../../../shared/utils/logger');
const authPublic = require('../../../auth/public');
const repository = require('../repositories/extensionCommand.repository');
const { extensionCommandTypes, extensionCommandStatuses } = require('../constants/extensionCommand.constants');
const { toManagementAgentDto } = require('../dtos/extensionCommand.dto');

const LEASE_MS = 5 * 60 * 1000;
const ONLINE_MS = 90 * 1000;
const shopScope = (shopId) => ({ scopeType: 'shop', scopeId: String(shopId) });
const forbidden = () => new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
const notFound = (message) => new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
const conflict = (message) => new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
const financeCommandTypes = [extensionCommandTypes.IMPORT_ADS_SPEND, extensionCommandTypes.IMPORT_TRANSACTIONS, extensionCommandTypes.IMPORT_SETTLEMENTS];
const lockedImportTypes = [extensionCommandTypes.IMPORT_NEW_ORDERS, ...financeCommandTypes];

async function createLockedImportCommand(payload) {
  try {
    return await repository.createCommand({ ...payload, activeOrderKey: String(payload.agentId) });
  } catch (error) {
    if (error?.code === 11000) throw conflict('An import is already active for this extension agent');
    throw error;
  }
}

function assertUserShopAccess(auth, shopId, permission) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  if (!authPublic.canAccessScope(auth, permission, shopScope(shopId))) throw forbidden();
}
function assertExtension(auth) {
  if (auth?.tokenType !== 'EXTENSION' || !auth.extensionTokenId) throw forbidden();
}
function isOnline(agent, now) {
  return !!agent?.lastSeenAt && now.getTime() - new Date(agent.lastSeenAt).getTime() <= ONLINE_MS;
}
function toUtcDate(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
function isoDate(value) {
  return value.toISOString().slice(0, 10);
}
function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
function previousCompletedUtcDate(now) {
  const date = toUtcDate(now);
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}
function transactionWindow(schedule, now) {
  const previousDay = previousCompletedUtcDate(now);
  const nextDate = schedule.lastSuccessfulDate ? addUtcDays(schedule.lastSuccessfulDate, 1) : previousDay;
  const targetDate = nextDate > previousDay ? previousDay : nextDate;
  return { dateFrom: targetDate, dateTo: targetDate };
}
function financeSourceForCommand(type) {
  if (type === extensionCommandTypes.IMPORT_TRANSACTIONS) return 'TRANSACTIONS';
  if (type === extensionCommandTypes.IMPORT_SETTLEMENTS) return 'SETTLEMENTS';
  return null;
}
function canReadShop(auth, shopId) {
  return ['ORDERS:READ', 'ORDERS:WRITE', 'FINANCE:READ', 'FINANCE:WRITE']
    .some((permission) => authPublic.canAccessScope(auth, permission, shopScope(shopId)));
}
function accessibleShopIds(auth, agents) {
  return [...new Set(agents.filter((agent) => canReadShop(auth, agent.shopId)).map((agent) => String(agent.shopId)))];
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
  const agents = (await repository.listAgents({})).filter((agent) => canReadShop(auth, agent.shopId));
  const tokens = await authPublic.getExtensionTokenMetadataByIds(agents.map((agent) => agent.extensionTokenId));
  const tokenById = new Map(tokens.map((token) => [String(token.id), token]));
  return { items: agents.map((agent) => toManagementAgentDto(agent, tokenById.get(String(agent.extensionTokenId)) || null, Date.now() - new Date(agent.lastSeenAt).getTime() <= ONLINE_MS ? 'ONLINE' : 'OFFLINE')) };
}

async function createCommand(input, auth) {
  assertUserShopAccess(auth, input.shopId, financeCommandTypes.includes(input.type) ? 'FINANCE:WRITE' : 'ORDERS:WRITE');
  const agent = await repository.findAgentById(input.agentId);
  if (!agent || String(agent.shopId) !== String(input.shopId)) throw notFound('Extension agent not found for shop');
  const payload = { type: input.type, shopId: input.shopId, agentId: input.agentId, numDays: input.numDays, dateFrom: input.dateFrom || null, dateTo: input.dateTo || null, createdByAccountId: auth.accountId || null };
  return lockedImportTypes.includes(input.type) ? createLockedImportCommand(payload) : repository.createCommand(payload);
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

async function queueCurrentOrderImport(input, auth) {
  const agent = await getCurrentAgent(auth, input);
  return createLockedImportCommand({ type: extensionCommandTypes.IMPORT_NEW_ORDERS, shopId: agent.shopId, agentId: agent._id || agent.id, numDays: input.numDays || 1, createdByAccountId: null });
}

async function queueCurrentAdsImport(input, auth) {
  const agent = await getCurrentAgent(auth, input);
  return createLockedImportCommand({ type: extensionCommandTypes.IMPORT_ADS_SPEND, shopId: agent.shopId, agentId: agent._id || agent.id, dateFrom: input.dateFrom, dateTo: input.dateTo, createdByAccountId: null });
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
    patch: { status: input.success ? extensionCommandStatuses.SUCCEEDED : extensionCommandStatuses.FAILED, completedAt: new Date(), leaseExpiresAt: null, leaseTokenHash: null, importJobId: input.importJobId || null, result: { importedCount: input.importedCount, failedCount: input.failedCount }, errorMessage: input.success ? null : (input.errorMessage || 'Extension task failed') }, unset: { activeOrderKey: 1 },
  });
  if (!command) throw conflict('Command is no longer completable');
  const financeSource = financeSourceForCommand(command.type);
  if (financeSource) {
    await repository.markFinanceScheduleCompleted({
      agentId: command.agentId,
      source: financeSource,
      now: new Date(),
      success: input.success,
      errorMessage: input.errorMessage,
      lastSuccessfulDate: input.success && financeSource === 'TRANSACTIONS' ? command.dateTo : null,
    });
  }
  return command;
}

async function dispatchDueOrderSchedules(now = new Date()) {
  const schedules = await repository.listDueOrderSchedules(now);
  for (const schedule of schedules) {
    if (!await repository.claimDueOrderSchedule(schedule._id, now, schedule.intervalMinutes)) continue;
    const agentId = schedule.agentId?._id || schedule.agentId;
    const agent = await repository.findAgentById(agentId);
    if (!isOnline(agent, now)) {
      await repository.postponeOrderSchedule(schedule._id, now, 'AGENT_OFFLINE');
      continue;
    }
    if (await repository.hasActiveImportCommand(agentId)) {
      await repository.postponeOrderSchedule(schedule._id, now, 'ACTIVE_ORDER_COMMAND');
      continue;
    }
    await createLockedImportCommand({ type: extensionCommandTypes.IMPORT_NEW_ORDERS, shopId: schedule.shopId, agentId, numDays: 1, createdByAccountId: null });
    await repository.markOrderScheduleQueued(schedule._id, now);
  }
}

async function dispatchDueFinanceSchedules(now = new Date()) {
  const schedules = await repository.listDueFinanceSchedules(now);
  for (const schedule of schedules) {
    if (!await repository.claimDueFinanceSchedule(schedule._id, now)) continue;
    const agentId = schedule.agentId?._id || schedule.agentId;
    const agent = await repository.findAgentById(agentId);
    if (!isOnline(agent, now)) {
      await repository.postponeFinanceSchedule(schedule._id, now, 'AGENT_OFFLINE');
      continue;
    }
    if (await repository.hasActiveImportCommand(agentId)) {
      await repository.postponeFinanceSchedule(schedule._id, now, 'ACTIVE_IMPORT_COMMAND');
      continue;
    }
    const payload = schedule.source === 'TRANSACTIONS'
      ? { type: extensionCommandTypes.IMPORT_TRANSACTIONS, ...transactionWindow(schedule, now) }
      : { type: extensionCommandTypes.IMPORT_SETTLEMENTS };
    await createLockedImportCommand({ ...payload, shopId: schedule.shopId, agentId, createdByAccountId: null });
    await repository.markFinanceScheduleQueued(schedule._id, now);
  }
}

async function listOrderSchedules(auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agents = await repository.listAgents({});
  const shopIds = accessibleShopIds(auth, agents);
  return shopIds.length ? repository.listOrderSchedules({ shopIds }) : [];
}

async function listFinanceSchedules(auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agents = await repository.listAgents({});
  const shopIds = accessibleShopIds(auth, agents);
  return shopIds.length ? repository.listFinanceSchedules({ shopIds }) : [];
}

async function upsertOrderSchedule(agentId, input, auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agent = await repository.findAgentById(agentId);
  if (!agent) throw notFound('Extension agent not found');
  assertUserShopAccess(auth, agent.shopId, 'ORDERS:WRITE');
  const now = new Date();
  const existing = await repository.findOrderScheduleByAgentId(agentId);
  const runImmediately = input.enabled && !existing?.enabled;
  const schedule = await repository.upsertOrderSchedule({ shopId: agent.shopId, agentId: agent._id || agent.id, enabled: input.enabled, intervalMinutes: input.intervalMinutes, now, runImmediately });
  if (!runImmediately) return schedule;
  await dispatchDueOrderSchedules(now);
  return repository.findOrderScheduleByAgentId(agentId);
}

async function upsertFinanceSchedule(agentId, source, input, auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agent = await repository.findAgentById(agentId);
  if (!agent) throw notFound('Extension agent not found');
  assertUserShopAccess(auth, agent.shopId, 'FINANCE:WRITE');
  return repository.upsertFinanceSchedule({
    shopId: agent.shopId,
    agentId: agent._id || agent.id,
    source,
    enabled: input.enabled,
    now: new Date(),
  });
}

async function requestFinanceScheduleNow(agentId, source, auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const agent = await repository.findAgentById(agentId);
  if (!agent) throw notFound('Extension agent not found');
  assertUserShopAccess(auth, agent.shopId, 'FINANCE:WRITE');
  const schedule = await repository.findFinanceSchedule({ agentId, source });
  if (!schedule?.enabled) throw conflict('Enable this Finance schedule before requesting it');
  const now = new Date();
  if (!isOnline(agent, now)) throw conflict('Extension agent is offline');
  if (await repository.hasActiveImportCommand(agentId)) throw conflict('An import is already active for this extension agent');
  if (!await repository.requestFinanceScheduleNow(schedule._id, now)) throw conflict('Finance schedule is no longer enabled');
  await dispatchDueFinanceSchedules(now);
  return repository.findFinanceSchedule({ agentId, source });
}

module.exports = { heartbeat, listAgents, listManagementAgents, createCommand, listCommands, queueCurrentOrderImport, queueCurrentAdsImport, claimNext, startCommand, completeCommand, dispatchDueOrderSchedules, dispatchDueFinanceSchedules, listOrderSchedules, upsertOrderSchedule, listFinanceSchedules, upsertFinanceSchedule, requestFinanceScheduleNow };
