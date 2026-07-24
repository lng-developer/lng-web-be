function toId(value) {
  if (value === undefined || value === null) return null;
  if (value._id !== undefined && value._id !== null) return String(value._id);
  if (typeof value.id === 'string') return value.id;
  return String(value);
}

function toOverrideDto(override) {
  if (!override) return null;
  return {
    points: override.points ?? null,
    reason: override.reason || null,
    overriddenBy: toId(override.overriddenBy),
    overriddenAt: override.overriddenAt || null,
  };
}

function toScoreDto(score) {
  if (!score) return null;
  return {
    id: toId(score._id || score.id),
    taskId: toId(score.taskId),
    submissionId: toId(score.submissionId),
    assetId: toId(score.assetId),
    taskType: score.taskType || null,
    submissionVersion: score.submissionVersion ?? null,
    designer: {
      id: toId(score.designerId),
      name: score.designerName || null,
    },
    team: score.teamId ? { id: toId(score.teamId), name: score.teamName || null } : null,
    department: score.departmentId
      ? { id: toId(score.departmentId), name: score.departmentName || null }
      : null,
    basePoints: score.basePoints ?? null,
    finalPoints: score.finalPoints ?? null,
    scoreLevel: score.scoreLevel || null,
    status: score.status || null,
    override: toOverrideDto(score.override),
    scoredBy: toId(score.scoredBy),
    scoredAt: score.scoredAt || null,
    voidedBy: toId(score.voidedBy),
    voidedAt: score.voidedAt || null,
    voidReason: score.voidReason || null,
  };
}

function toScoreSummaryDto(summary = {}) {
  return {
    totalPoints: summary.totalPoints ?? 0,
    totalFiles: summary.totalFiles ?? 0,
    byDesigner: (summary.byDesigner || []).map((row) => ({
      designerId: toId(row.designerId),
      designerName: row.designerName || null,
      teamId: toId(row.teamId),
      teamName: row.teamName || null,
      departmentId: toId(row.departmentId),
      departmentName: row.departmentName || null,
      totalPoints: row.totalPoints ?? 0,
      totalFiles: row.totalFiles ?? 0,
    })),
    byTaskType: (summary.byTaskType || []).map((row) => ({
      taskType: row.taskType || null,
      totalPoints: row.totalPoints ?? 0,
      totalFiles: row.totalFiles ?? 0,
    })),
  };
}

module.exports = {
  toScoreDto,
  toScoreSummaryDto,
};
