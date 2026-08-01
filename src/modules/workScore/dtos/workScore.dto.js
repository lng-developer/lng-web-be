function toId(value) {
  if (value === undefined || value === null) return null;
  return String(value._id || value.id || value);
}

function toWorkScoreDto(score) {
  if (!score) return null;
  return {
    id: toId(score._id || score.id),
    sourceType: score.sourceType,
    sourceTaskId: toId(score.sourceTaskId),
    sourceUnitId: toId(score.sourceUnitId),
    assetId: toId(score.assetId),
    assetDownloadUrl: score.assetId ? `/api/media/assets/${toId(score.assetId)}/download` : null,
    shopId: toId(score.shopId),
    workerId: toId(score.workerId),
    workerName: score.workerName || null,
    contextSnapshot: score.contextSnapshot || null,
    basePoints: score.basePoints,
    finalPoints: score.finalPoints,
    scoreLevel: score.scoreLevel,
    status: score.status,
    adjustments: score.adjustments || [],
    version: score.__v ?? 0,
    scoredAt: score.scoredAt || null,
  };
}

module.exports = { toWorkScoreDto };
