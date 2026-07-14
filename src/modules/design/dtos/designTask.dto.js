const {
  activeDesignTaskStatuses,
  designTaskPriorities,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');

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

function toAssetDto(asset) {
  if (!asset) return null;
  return {
    id: toId(asset._id || asset.id),
    originalFilename: asset.originalFilename || null,
    mimeType: asset.mimeType || null,
    size: asset.size ?? null,
    createdAt: asset.createdAt || null,
  };
}

function toProfileDto(profile, accountId) {
  if (!accountId) return null;
  return {
    id: accountId,
    fullName: profile?.fullName || null,
    avatarUrl: profile?.avatarUrl || null,
  };
}

function toShopRef(shop, shopId) {
  if (!shopId) return null;
  return {
    id: shopId,
    name: shop?.name || null,
  };
}

function latestByVersion(items = [], predicate = () => true) {
  return [...items]
    .filter(predicate)
    .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))[0] || null;
}

function buildSubmissions(task = {}) {
  if ((task.submissions || []).length) return task.submissions;
  if (!(task.submittedAssetIds || []).length) return [];
  return [{
    version: 1,
    assetIds: task.submittedAssetIds,
    submittedBy: task.submittedBy || null,
    submittedAt: task.submittedAt || null,
    note: task.note || null,
    status: task.status === designTaskStatuses.APPROVED ? 'APPROVED' : 'SUBMITTED',
    approvedAssetId: task.approvedAssetId || null,
    approvedBy: task.approvedBy || null,
    approvedAt: task.approvedAt || null,
    rejectedBy: task.rejectedBy || null,
    rejectedAt: task.rejectedAt || null,
    rejectReason: task.rejectReason || null,
  }];
}

function toSubmissionDto(submission = {}, assetsById = {}) {
  const assetIds = (submission.assetIds || []).map(toId);
  return {
    id: toId(submission._id || submission.id),
    version: submission.version || null,
    status: submission.status || null,
    assetIds,
    assets: assetIds.map((assetId) => toAssetDto(assetsById[assetId])).filter(Boolean),
    submittedBy: toId(submission.submittedBy),
    submittedAt: submission.submittedAt || null,
    note: submission.note || null,
    approvedAssetId: toId(submission.approvedAssetId),
    approvedAsset: toAssetDto(assetsById[toId(submission.approvedAssetId)]),
    approvedBy: toId(submission.approvedBy),
    approvedAt: submission.approvedAt || null,
    rejectedBy: toId(submission.rejectedBy),
    rejectedAt: submission.rejectedAt || null,
    rejectReason: submission.rejectReason || null,
    removedBy: toId(submission.removedBy),
    removedAt: submission.removedAt || null,
  };
}

function toDesignTaskDto(task, {
  assetsById = {},
  detail = false,
  profilesByAccountId = {},
  shopsById = {},
} = {}) {
  if (!task) return null;
  const assignedDesignerId = toId(task.assignedDesignerId);
  const shopId = toId(task.shopId);
  const thumbnailAssetId = toId((task.referenceAssetIds || [])[0]);
  const submissions = buildSubmissions(task);
  const latestSubmission = latestByVersion(submissions, (submission) => submission.status !== 'REMOVED');
  const approvedSubmission = latestByVersion(submissions, (submission) => submission.status === 'APPROVED');
  const latestSubmittedAssetIds = latestSubmission?.assetIds || task.submittedAssetIds || [];
  const latestSubmittedAssetId = toId(latestSubmittedAssetIds[Math.max(latestSubmittedAssetIds.length - 1, 0)]);
  const shop = toShopRef(shopsById[shopId], shopId);
  const dto = {
    id: toId(task._id || task.id),
    taskType: task.taskType,
    status: task.status,
    priority: task.priority || designTaskPriorities.NORMAL,
    listing: toSnapshot(task.listingSnapshot),
    internalTemplate: toSnapshot(task.internalTemplateSnapshot),
    brief: task.brief || null,
    expectedOutputs: task.expectedOutputs || [],
    referenceAssetCount: (task.referenceAssetIds || []).length,
    targetListingId: toId(task.targetListingId || task.listingId),
    sourceListingId: toId(task.sourceListingId),
    sourceInternalTemplateId: toId(task.sourceInternalTemplateId),
    assignedDesignerId,
    assignedDesigner: toProfileDto(profilesByAccountId[assignedDesignerId], assignedDesignerId),
    shop,
    seller: shop,
    asinType: 'NORMAL',
    thumbnailAsset: toAssetDto(assetsById[thumbnailAssetId]),
    submittedAssetCount: (task.submittedAssetIds || []).length,
    submissionCount: submissions.filter((submission) => submission.status !== 'REMOVED').length,
    latestSubmission: latestSubmission ? toSubmissionDto(latestSubmission, assetsById) : null,
    latestSubmittedAsset: toAssetDto(assetsById[latestSubmittedAssetId]),
    approvedAssetId: toId(task.approvedAssetId),
    hasActivePsdTask: task.taskType === designTaskTypes.PSD_TEMPLATE
      && activeDesignTaskStatuses.includes(task.status),
    note: task.note || null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  if (detail) {
    dto.listingId = toId(task.listingId);
    dto.shopId = toId(task.shopId);
    dto.productTypeGroupId = toId(task.productTypeGroupId);
    dto.internalTemplateId = toId(task.internalTemplateId);
    dto.referenceAssetIds = (task.referenceAssetIds || []).map(toId);
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
    dto.submissions = submissions.map((submission) => toSubmissionDto(submission, assetsById));
    dto.approvedSubmission = approvedSubmission ? toSubmissionDto(approvedSubmission, assetsById) : null;
  }

  return dto;
}

function toPaginatedResponse(result = {}) {
  return {
    items: (result.items || []).map((task) => toDesignTaskDto(task, result.dtoOptions || {})),
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
