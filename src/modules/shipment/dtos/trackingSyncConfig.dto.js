function toTrackingSyncConfigDto(config) {
  if (!config) return null;
  return {
    enabled: Boolean(config.enabled),
    intervalMinutes: config.intervalMinutes,
    batchSize: config.batchSize,
    lastRunAt: config.lastRunAt || null,
    lastRunFinishedAt: config.lastRunFinishedAt || null,
    lastRunSummary: config.lastRunSummary || null,
    updatedAt: config.updatedAt || null,
  };
}

module.exports = { toTrackingSyncConfigDto };

function toTrackingMonitoringDto(rows) {
  const providers = require('../constants/shipment.constants').SUPPORTED_TRACKING_PROVIDERS;
  const names = [...providers, ...(rows.some(row => row._id === 'LEGACY') ? ['LEGACY'] : [])];
  return {
    available: true, capturedAt: new Date(),
    providers: names.map(provider => {
      const row = rows.find(entry => entry._id === provider) || {};
      return { provider, waiting: row.waiting || 0, processing: row.processing || 0,
        scheduled: row.scheduled || 0, completed: row.completed || 0, errors: row.errors || 0,
        lastAttemptAt: row.lastAttemptAt || null };
    }),
  };
}
module.exports.toTrackingMonitoringDto = toTrackingMonitoringDto;
