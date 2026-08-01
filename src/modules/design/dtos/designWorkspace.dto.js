function toAssetDto(asset) {
  if (!asset) return null;
  const id = asset._id || asset.id;
  return {
    id: String(id),
    originalFilename: asset.originalFilename || null,
    mimeType: asset.mimeType || null,
    size: asset.size ?? null,
    createdAt: asset.createdAt || null,
    downloadUrl: id ? `/api/media/assets/${id}/download` : null,
  };
}

function toSubmissionScoreListItemDto(row, assetsById, scorersByAccountId = {}) {
  const scorerId = row.scoredBy ? String(row.scoredBy) : null;
  return {
    id: String(row._id),
    task: {
      id: String(row.task._id),
      taskType: row.task.taskType,
      status: row.task.status,
    },
    listing: {
      id: String(row.task.listingId),
      code: row.task.listingSnapshot?.sku || row.task.listingSnapshot?.asin || null,
      title: row.task.listingSnapshot?.title || null,
    },
    submission: {
      id: String(row.submissionId),
      version: row.submissionVersion || row.submission?.version || null,
      approvedAt: row.submission?.approvedAt || null,
    },
    file: toAssetDto(assetsById[String(row.assetId)]),
    designer: {
      id: String(row.designerId),
      name: row.designerName || null,
    },
    score: {
      basePoints: row.basePoints ?? null,
      finalPoints: row.finalPoints ?? null,
      scoreLevel: row.scoreLevel || null,
      status: row.status || null,
      scoredAt: row.scoredAt || null,
      scorer: {
        id: scorerId,
        name: scorerId ? scorersByAccountId[scorerId]?.fullName || null : 'Automated',
      },
      override: row.override || null,
      voidReason: row.voidReason || null,
      voidedAt: row.voidedAt || null,
    },
  };
}

function toPsdFileListItemDto(row, assetsById) {
  const taskId = String(row._id);
  const assetId = String(row.fileLinks.assetId);
  const submissionId = row.fileLinks.submissionId
    ? String(row.fileLinks.submissionId)
    : null;
  return {
    rowKey: `${assetId}:${taskId}:${row.fileLinks.role}:${submissionId || 'task'}`,
    asset: toAssetDto(assetsById[assetId]),
    linkedAt: row.fileLinks.linkedAt || null,
    role: row.fileLinks.role,
    task: {
      id: taskId,
      taskType: row.taskType,
      status: row.status,
    },
    listing: {
      id: String(row.listingId),
      code: row.listingSnapshot?.sku || row.listingSnapshot?.asin || null,
      title: row.listingSnapshot?.title || null,
    },
    designer: {
      id: row.assignedDesignerId ? String(row.assignedDesignerId) : null,
      name: row.assignedDesignerName || null,
    },
    submission: {
      id: submissionId,
      version: row.fileLinks.version || null,
      submittedAt: row.fileLinks.linkedAt || null,
    },
  };
}

module.exports = {
  toAssetDto,
  toPsdFileListItemDto,
  toSubmissionScoreListItemDto,
};
