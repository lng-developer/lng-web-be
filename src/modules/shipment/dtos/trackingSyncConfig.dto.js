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
