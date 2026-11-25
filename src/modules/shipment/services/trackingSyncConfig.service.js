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

async function recordRun(result, authContext, timing = {}) {
  const now = new Date();
  const defaults = environmentDefaults();
  const summary = {
    ...(result?.queued !== undefined && { queued: result.queued, failedProviders: result.failedProviders || [] }),
    checked: Number(result?.checked) || 0,
    applied: Number(result?.applied) || 0,
    skipped: Number(result?.skipped) || 0,
    failed: Number(result?.failed) || 0,
    durationMs: timing.startedAt && timing.finishedAt
      ? Math.max(0, timing.finishedAt - timing.startedAt) : null,
  };
  const config = toTrackingSyncConfigDto(await repository.upsert({
    lastRunAt: timing.startedAt || now,
    lastRunFinishedAt: timing.finishedAt || now,
    lastRunSummary: summary,
  }, { enabled: defaults.enabled, batchSize: defaults.batchSize, intervalMinutes: defaults.intervalMinutes }));
  await record('SHIPMENT_TRACKING_SYNC_RUN_COMPLETED', config, authContext, summary);
  return config;
}

module.exports = { get, recordRun, update };

async function getWithMonitoring(authContext = {}) {
  const settings = await get();
  const config = require('../../../config');
  const queueEnabled = Boolean(config.shipment.trackingQueueEnabled);
  if (!queueEnabled || !authContext.permissions?.includes(require('../constants/shipment.constants').shipmentPermissions.WRITE)) return { ...settings, queueEnabled };
  try {
    const rows = await require('../repositories/vendorTrackingPoll.repository').summarizeByProvider();
    return { ...settings, queueEnabled, monitoring: require('../dtos/trackingSyncConfig.dto').toTrackingMonitoringDto(rows) };
  } catch {
    return { ...settings, queueEnabled, monitoring: { available: false, providers: [] } };
  }
}
module.exports.getWithMonitoring = getWithMonitoring;
