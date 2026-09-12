const crypto = require('crypto');
const auditPublic = require('../../audit/public');
const repository = require('../repositories/trackingSyncConfig.repository');
const { toTrackingSyncConfigDto } = require('../dtos/trackingSyncConfig.dto');

function environmentDefaults() {
  return {
    enabled: String(process.env.VENDOR_TRACKING_RECHECK_ENABLED || '').toLowerCase() === 'true',
    intervalMinutes: Math.max(Number(process.env.VENDOR_TRACKING_RECHECK_INTERVAL_MS) || 15 * 60 * 1000, 60 * 1000) / 60_000,
    batchSize: Math.min(Math.max(Number(process.env.VENDOR_TRACKING_RECHECK_LIMIT) || 50, 1), 100),
    lastRunAt: null,
    lastRunFinishedAt: null,
    lastRunSummary: null,
    updatedAt: null,
  };
}

async function get() {
  return toTrackingSyncConfigDto(await repository.get()) || environmentDefaults();
}

function auditActor(authContext = {}) {
  return authContext.accountId
    ? { actorType: 'ACCOUNT', actorAccountId: authContext.accountId }
    : { actorType: 'SYSTEM', actorAccountId: null };
}

async function record(action, config, authContext = {}, metadata = {}) {
  await auditPublic.record({
    ...auditActor(authContext),
    actorSnapshot: {},
    action,
    entityType: 'SHIPMENT_TRACKING_SYNC_CONFIG',
    entityId: 'DEFAULT',
    scopeType: null,
    scopeId: null,
    outcome: 'SUCCEEDED',
    source: authContext.source || (authContext.system ? 'SYSTEM' : 'HTTP'),
    requestId: authContext.auditContext?.requestId || null,
    ipAddress: authContext.auditContext?.ipAddress || null,
    userAgent: authContext.auditContext?.userAgent || null,
    changes: null,
    metadata,
    deduplicationKey: `${action}:${crypto.randomUUID()}`,
  }, {});
  return config;
}

async function update(input, authContext) {
  const config = toTrackingSyncConfigDto(await repository.upsert(input));
  await record('SHIPMENT_TRACKING_SYNC_CONFIG_UPDATED', config, authContext, {
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    batchSize: config.batchSize,
  });
  return config;
}

async function recordRun(result, authContext) {
  const now = new Date();
  const current = await get();
  const summary = {
    checked: Number(result?.checked) || 0,
    applied: Number(result?.applied) || 0,
    skipped: Number(result?.skipped) || 0,
    failed: Number(result?.failed) || 0,
  };
  const config = toTrackingSyncConfigDto(await repository.upsert({
    enabled: current.enabled,
    intervalMinutes: current.intervalMinutes,
    batchSize: current.batchSize,
    lastRunAt: now,
    lastRunFinishedAt: now,
    lastRunSummary: summary,
  }));
  await record('SHIPMENT_TRACKING_SYNC_RUN_COMPLETED', config, authContext, summary);
  return config;
}

module.exports = { get, recordRun, update };
