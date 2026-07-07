function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot.id || snapshot._id),
    sku: snapshot.sku || null,
    title: snapshot.title || null,
    asin: snapshot.asin || null,
    etsyListingId: snapshot.etsyListingId || null,
    code: snapshot.code || null,
    name: snapshot.name || null,
    status: snapshot.status || null,
    psdStatus: snapshot.psdStatus || null,
  };
}

function toDesignTaskDto(task, { detail = false } = {}) {
  if (!task) return null;
  const dto = {
    id: toId(task._id || task.id),
    taskType: task.taskType,
    status: task.status,
    listing: toSnapshot(task.listingSnapshot),
    internalTemplate: toSnapshot(task.internalTemplateSnapshot),
    assignedDesignerId: toId(task.assignedDesignerId),
    submittedAssetCount: (task.submittedAssetIds || []).length,
    approvedAssetId: toId(task.approvedAssetId),
    note: task.note || null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  if (detail) {
    dto.listingId = toId(task.listingId);
    dto.shopId = toId(task.shopId);
    dto.productTypeGroupId = toId(task.productTypeGroupId);
    dto.internalTemplateId = toId(task.internalTemplateId);
    dto.submittedAssetIds = (task.submittedAssetIds || []).map(toId);
    dto.rejectReason = task.rejectReason || null;
    dto.submittedBy = toId(task.submittedBy);
    dto.submittedAt = task.submittedAt || null;
    dto.approvedBy = toId(task.approvedBy);
    dto.approvedAt = task.approvedAt || null;
    dto.rejectedBy = toId(task.rejectedBy);
    dto.rejectedAt = task.rejectedAt || null;
    dto.cancelledBy = toId(task.cancelledBy);
    dto.cancelledAt = task.cancelledAt || null;
  }

  return dto;
}

function toPaginatedResponse(result = {}) {
  return {
    items: (result.items || []).map((task) => toDesignTaskDto(task)),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toDesignTaskDto,
  toId,
  toPaginatedResponse,
};
