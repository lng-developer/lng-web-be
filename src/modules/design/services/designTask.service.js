const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const mediaPublic = require('../../media/public');
const productionPublic = require('../../production/public');
const shopPublic = require('../../shop/public');
const {
  designPermissions,
  designTaskOutputTypes,
  designTaskPriorities,
  designTaskSubmissionStatuses,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');
const scoreRepository = require('../repositories/designSubmissionScore.repository');
const repository = require('../repositories/designTask.repository');
const { toDesignTaskDto, toId, toPaginatedResponse } = require('../dtos/designTask.dto');
const {
  toPsdFileListItemDto,
  toSubmissionScoreListItemDto,
} = require('../dtos/designWorkspace.dto');
const scoreService = require('./designSubmissionScore.service');

const SHOP_SCOPE_TYPE = 'shop';
const PSD_MISSING_STATUS = 'MISSING';
const BULK_PSD_MAX_LIMIT = 100;
const DESIGN_READ_SCOPE_PERMISSIONS = [
  designPermissions.READ,
  designPermissions.WRITE,
  designPermissions.REVIEW,
];

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict(message, details) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, details);
}

function validationError(message, details) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, details);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasPermission(authContext = {}, permission) {
  const permissions = [
    ...(authContext.permissions || []),
    ...(authContext.scopes || []).flatMap((scope) => scope.permissions || []),
  ];
  return permissions.includes(permission) || permissions.includes(designPermissions.WRITE) || (
    permission === designPermissions.READ
    && permissions.includes(designPermissions.WRITE)
  );
}

function hasGlobalPermission(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission) || permissions.includes(designPermissions.WRITE);
}

function hasGlobalAnyPermission(authContext = {}, permissions = []) {
  return permissions.some((permission) => hasGlobalPermission(authContext, permission));
}

function isSystemContext(authContext = {}) {
  return authContext && authContext.system === true;
}

function scopedShopIds(authContext = {}, permissions = []) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => scope.scopeType === SHOP_SCOPE_TYPE)
    .filter((scope) => permissions.some((permission) => (scope.permissions || []).includes(permission)))
    .map((scope) => String(scope.scopeId))
    .filter(Boolean))];
}

function normalizeQueryAliases(query = {}) {
  const normalized = { ...query };
  if (normalized.sellerId && !normalized.shopId) normalized.shopId = normalized.sellerId;
  delete normalized.sellerId;
  return normalized;
}

function assertCanAccessShop(shopId, permission, authContext = {}) {
  if (isSystemContext(authContext)) return;
  if (hasGlobalPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function assertCanAccessShopAny(shopId, permissions, authContext = {}) {
  if (isSystemContext(authContext)) return;
  if (permissions.some((permission) => hasGlobalPermission(authContext, permission))) return;
  if (permissions.some((permission) => (
    authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })
  ))) return;
  throw forbidden();
}

function isAssignedToActor(task, authContext = {}) {
  return authContext.accountId
    && task.assignedDesignerId
    && String(task.assignedDesignerId) === String(authContext.accountId);
}

function hasFullRead(authContext = {}) {
  return hasPermission(authContext, designPermissions.READ)
    || hasPermission(authContext, designPermissions.REVIEW);
}

function assertCanReadTask(task, authContext = {}) {
  if (hasFullRead(authContext)) {
    assertCanAccessShopAny(task.shopId, DESIGN_READ_SCOPE_PERMISSIONS, authContext);
    return;
  }
  if (hasPermission(authContext, designPermissions.WORK) && isAssignedToActor(task, authContext)) {
    assertCanAccessShopAny(task.shopId, [designPermissions.WORK, designPermissions.WRITE], authContext);
    return;
  }
  throw forbidden();
}

function assertCanWorkTask(task, authContext = {}) {
  if (hasPermission(authContext, designPermissions.WRITE)) {
    assertCanAccessShopAny(task.shopId, [designPermissions.WRITE], authContext);
    return;
  }
  if (hasPermission(authContext, designPermissions.WORK) && isAssignedToActor(task, authContext)) {
    assertCanAccessShopAny(task.shopId, [designPermissions.WORK, designPermissions.WRITE], authContext);
    return;
  }
  throw forbidden();
}

function assertCanReviewTask(task, authContext = {}) {
  if (hasPermission(authContext, designPermissions.REVIEW)) {
    assertCanAccessShopAny(task.shopId, [designPermissions.REVIEW, designPermissions.WRITE], authContext);
    return;
  }
  throw forbidden();
}

function applyReadAccessFilter(query = {}, authContext = {}) {
  const normalizedQuery = normalizeQueryAliases(query);
  if (hasFullRead(authContext)) {
    if (normalizedQuery.shopId) {
      assertCanAccessShopAny(normalizedQuery.shopId, DESIGN_READ_SCOPE_PERMISSIONS, authContext);
    }
    if (!hasGlobalAnyPermission(authContext, DESIGN_READ_SCOPE_PERMISSIONS) && !normalizedQuery.shopId) {
      return {
        ...normalizedQuery,
        shopIds: scopedShopIds(authContext, DESIGN_READ_SCOPE_PERMISSIONS),
      };
    }
    return normalizedQuery;
  }

  if (!hasPermission(authContext, designPermissions.WORK) || !authContext.accountId) throw forbidden();
  if (normalizedQuery.shopId) assertCanAccessShop(normalizedQuery.shopId, designPermissions.WORK, authContext);
  return {
    ...normalizedQuery,
    assignedDesignerId: authContext.accountId,
    ...(!hasGlobalPermission(authContext, designPermissions.WORK) && !normalizedQuery.shopId
      ? { shopIds: scopedShopIds(authContext, [designPermissions.WORK]) }
      : {}),
  };
}

async function applyOrderIdFilter(query = {}) {
  if (!query.orderId) return query;
  const blockedTasks = await productionPublic.listPsdBlockedTasksByExternalOrderId(query.orderId);
  return {
    ...query,
    listingIds: uniqueIds((blockedTasks || []).map((task) => task.listingId)),
  };
}

function isDuplicateKey(error) {
  return error && error.code === 11000;
}

function pickId(value) {
  return toId(value);
}

function uniqueIds(values = []) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function assertTaskPayload(payload = {}) {
  if (payload.taskType === designTaskTypes.IDEA && !String(payload.brief || '').trim()) {
    throw validationError('brief is required for IDEA task');
  }
  if (
    payload.taskType === designTaskTypes.CLONE
    && !payload.sourceListingId
    && !payload.sourceInternalTemplateId
  ) {
    throw validationError('sourceListingId or sourceInternalTemplateId is required for CLONE task');
  }
  if (
    payload.targetListingId
    && payload.listingId
    && String(payload.targetListingId) !== String(payload.listingId)
  ) {
    throw validationError('targetListingId must match listingId in V1');
  }
}

async function assertMediaAssetsExist(mediaAssetIds = []) {
  const ids = uniqueIds(mediaAssetIds);
  await Promise.all(ids.map((mediaAssetId) => mediaPublic.assertMediaAssetExists(mediaAssetId)));
  return ids;
}

function isPsdLikeAsset(asset) {
  const filename = String(asset?.originalFilename || '').toLowerCase();
  const mimeType = String(asset?.mimeType || '').toLowerCase();
  return filename.endsWith('.psd')
    || filename.endsWith('.zip')
    || filename.endsWith('.rar')
    || mimeType.includes('photoshop')
    || mimeType.includes('x-photoshop')
    || mimeType.includes('zip')
    || mimeType.includes('rar');
}

function listingSnapshot(listing) {
  return {
    id: pickId(listing._id || listing.id),
    shopId: pickId(listing.shopId),
    sku: listing.sku || null,
    title: listing.title || null,
    asin: listing.asin || null,
    etsyListingId: listing.etsyListingId || null,
    productTypeGroupId: pickId(listing.productTypeGroupId),
    internalTemplateId: pickId(listing.internalTemplateId),
    psdStatus: listing.psdStatus || null,
  };
}

function internalTemplateSnapshot(template) {
  if (!template) return null;
  return {
    id: pickId(template._id || template.id),
    code: template.code || null,
    name: template.name || null,
    status: template.status || null,
  };
}

async function buildTaskSnapshot(listing) {
  const internalTemplateId = pickId(listing.internalTemplateId);
  const template = internalTemplateId
    ? await catalogPublic.getInternalTemplateById(internalTemplateId)
    : null;
  return {
    listingSnapshot: listingSnapshot(listing),
    internalTemplateSnapshot: internalTemplateSnapshot(template),
  };
}

function mapById(items = [], idPicker = (item) => item && (item._id || item.id)) {
  return Object.fromEntries((items || [])
    .map((item) => [toId(idPicker(item)), item])
    .filter(([id]) => Boolean(id)));
}

async function buildDtoOptions(tasks = [], { includeScores = false } = {}) {
  const assignedDesignerIds = uniqueIds(tasks.map((task) => task.assignedDesignerId));
  const shopIds = uniqueIds(tasks.map((task) => task.shopId));
  const listingIds = uniqueIds(tasks.map((task) => task.targetListingId || task.listingId));
  const submissionIds = uniqueIds(tasks.flatMap((task) => getSubmissions(task)
    .map((submission) => submission._id || submission.id)));
  const thumbnailAssetIds = uniqueIds(tasks.map((task) => (task.referenceAssetIds || [])[0]));
  const latestAssetIds = uniqueIds(tasks.map((task) => {
    const ids = task.submittedAssetIds || [];
    return ids.length ? ids[ids.length - 1] : null;
  }));
  const submissionAssetIds = uniqueIds(tasks.flatMap((task) => (
    task.submissions || []
  ).flatMap((submission) => [
    ...(submission.assetIds || []),
    submission.approvedAssetId,
  ])));
  const assetIds = uniqueIds([...thumbnailAssetIds, ...latestAssetIds, ...submissionAssetIds]);

  const [profiles, shops, assets, orderContexts, scores] = await Promise.all([
    assignedDesignerIds.length ? authPublic.listProfilesByAccountIds(assignedDesignerIds) : [],
    Promise.all(shopIds.map((shopId) => shopPublic.findById(shopId))),
    assetIds.length && typeof mediaPublic.getAssetsByIds === 'function'
      ? mediaPublic.getAssetsByIds(assetIds)
      : [],
    Promise.all(listingIds.map(async (listingId) => {
      const blockedTasks = await productionPublic.listPsdBlockedTasksByListing(listingId);
      const externalOrderIds = uniqueIds((blockedTasks || []).map((task) => task.externalOrderId));
      return [listingId, {
        externalOrderId: externalOrderIds[0] || null,
        blockedOrderCount: externalOrderIds.length,
      }];
    })),
    includeScores && submissionIds.length ? scoreRepository.findBySubmissionIds(submissionIds) : [],
  ]);

  return {
    profilesByAccountId: mapById(profiles, (profile) => profile.accountId),
    shopsById: mapById(shops),
    assetsById: mapById(assets),
    orderContextByListingId: Object.fromEntries(orderContexts),
    scoresBySubmissionId: mapById(scores, (score) => score.submissionId),
    includeScores,
  };
}

async function loadTask(taskId) {
  assertValidObjectId(taskId, 'taskId');
  const task = await repository.findById(taskId);
  if (!task) throw notFound('Design task not found');
  return task;
}

function assertStatus(task, allowedStatuses, action) {
  if (!allowedStatuses.includes(task.status)) {
    throw conflict(`Design task cannot be ${action} from ${task.status}`, {
      status: task.status,
      allowedStatuses,
    });
  }
}

function normalizeSubmission(submission = {}) {
  return {
    ...(submission._id ? { _id: submission._id } : {}),
    ...(submission.id && !submission._id ? { id: submission.id } : {}),
    version: submission.version,
    assetIds: uniqueIds(submission.assetIds),
    submittedBy: submission.submittedBy || null,
    submittedAt: submission.submittedAt || null,
    note: submission.note || null,
    status: submission.status,
    approvedAssetId: submission.approvedAssetId || null,
    approvedBy: submission.approvedBy || null,
    approvedAt: submission.approvedAt || null,
    rejectedBy: submission.rejectedBy || null,
    rejectedAt: submission.rejectedAt || null,
    rejectReason: submission.rejectReason || null,
    removedBy: submission.removedBy || null,
    removedAt: submission.removedAt || null,
  };
}

function getSubmissions(task = {}) {
  const submissions = (task.submissions || []).map(normalizeSubmission);
  if (submissions.length) return submissions;
  const assetIds = uniqueIds(task.submittedAssetIds);
  if (!assetIds.length) return [];
  return [normalizeSubmission({
    version: 1,
    assetIds,
    submittedBy: task.submittedBy || null,
    submittedAt: task.submittedAt || null,
    note: task.note || null,
    status: task.status === designTaskStatuses.APPROVED
      ? designTaskSubmissionStatuses.APPROVED
      : designTaskSubmissionStatuses.SUBMITTED,
    approvedAssetId: task.approvedAssetId || null,
    approvedBy: task.approvedBy || null,
    approvedAt: task.approvedAt || null,
    rejectedBy: task.rejectedBy || null,
    rejectedAt: task.rejectedAt || null,
    rejectReason: task.rejectReason || null,
  })];
}

function nextSubmissionVersion(submissions = []) {
  return submissions.reduce((max, submission) => Math.max(max, Number(submission.version) || 0), 0) + 1;
}

function selectSubmittedSubmission(submissions = [], payload = {}) {
  const selected = payload.submissionId
    ? submissions.find((submission) => String(submission._id || submission.id) === String(payload.submissionId))
    : payload.version
      ? submissions.find((submission) => Number(submission.version) === Number(payload.version))
      : [...submissions].reverse().find((submission) => submission.status === designTaskSubmissionStatuses.SUBMITTED);

  if (!selected) throw validationError('Submitted submission not found');
  if (selected.status !== designTaskSubmissionStatuses.SUBMITTED) {
    throw conflict(`Submission cannot be reviewed from ${selected.status}`, { status: selected.status });
  }
  return selected;
}

function updateSubmission(submissions = [], target, patch = {}) {
  const targetId = String(target._id || target.id || '');
  return submissions.map((submission) => {
    const sameId = targetId && String(submission._id || submission.id || '') === targetId;
    const sameVersion = !targetId && Number(submission.version) === Number(target.version);
    return sameId || sameVersion ? { ...submission, ...patch } : submission;
  });
}

async function listTasks(query = {}, authContext) {
  const result = await repository.list(await applyOrderIdFilter(applyReadAccessFilter(query, authContext)));
  if (authContext) {
    result.items.forEach((task) => assertCanReadTask(task, authContext));
  }
  return toPaginatedResponse({
    ...result,
    dtoOptions: await buildDtoOptions(result.items),
  });
}

async function withAssetFilenameFilter(query = {}) {
  const search = String(query.search || '').trim();
  if (!search) return query;
  return {
    ...query,
    matchingAssetIds: await mediaPublic.findAssetIdsByOriginalFilename(search),
  };
}

async function assetsByIdForRows(rows = [], assetIdPicker) {
  const assetIds = uniqueIds(rows.map(assetIdPicker));
  return mapById(assetIds.length ? await mediaPublic.getAssetsByIds(assetIds) : []);
}

async function listSubmissionScores(query = {}, authContext) {
  const scopedQuery = applyReadAccessFilter({
    ...(await withAssetFilenameFilter(query)),
    taskType: designTaskTypes.PSD_TEMPLATE,
  }, authContext);
  const result = await scoreRepository.listPsdScoreRows(scopedQuery);
  const scorerIds = uniqueIds(result.items.map((row) => row.scoredBy));
  const [assetsById, scorerProfiles] = await Promise.all([
    assetsByIdForRows(result.items, (row) => row.assetId),
    scorerIds.length ? authPublic.listProfilesByAccountIds(scorerIds) : [],
  ]);
  const scorersByAccountId = mapById(scorerProfiles, (profile) => profile.accountId);
  return {
    ...result,
    items: result.items.map(
      (row) => toSubmissionScoreListItemDto(row, assetsById, scorersByAccountId),
    ),
  };
}

async function listPsdFiles(query = {}, authContext) {
  const filenameQuery = await withAssetFilenameFilter(query);
  const { designerId, ...taskQuery } = filenameQuery;
  const scopedQuery = applyReadAccessFilter({
    ...taskQuery,
    ...(designerId ? { assignedDesignerId: designerId } : {}),
    taskType: designTaskTypes.PSD_TEMPLATE,
  }, authContext);
  const result = await repository.listPsdFileLinks(scopedQuery);
  const designerIds = uniqueIds(result.items.map((row) => row.assignedDesignerId));
  const [assetsById, profiles] = await Promise.all([
    assetsByIdForRows(result.items, (row) => row.fileLinks.assetId),
    designerIds.length ? authPublic.listProfilesByAccountIds(designerIds) : [],
  ]);
  const profilesByAccountId = mapById(profiles, (profile) => profile.accountId);
  return {
    ...result,
    items: result.items.map((row) => toPsdFileListItemDto({
      ...row,
      assignedDesignerName: profilesByAccountId[String(row.assignedDesignerId)]?.fullName || null,
    }, assetsById)),
  };
}

async function getTask(taskId, authContext) {
  const task = await loadTask(taskId);
  assertCanReadTask(task, authContext);
  return toDesignTaskDto(task, { detail: true, ...(await buildDtoOptions([task], { includeScores: true })) });
}

async function listSubmissions(taskId, authContext) {
  const task = await loadTask(taskId);
  assertCanReadTask(task, authContext);
  const options = await buildDtoOptions([task], { includeScores: true });
  return {
    items: (toDesignTaskDto(task, { detail: true, ...options }).submissions || []),
  };
}

async function getWorkload(query = {}, authContext) {
  return repository.getWorkload(applyReadAccessFilter(query, authContext));
}

async function summarizeTasks(query = {}, authContext) {
  const workload = await getWorkload(query, authContext);
  const byStatus = workload.totals?.byStatus || {};
  return {
    total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    requested: byStatus[designTaskStatuses.REQUESTED] || 0,
    open: byStatus[designTaskStatuses.OPEN] || 0,
    assigned: byStatus[designTaskStatuses.ASSIGNED] || 0,
    inProgress: byStatus[designTaskStatuses.IN_PROGRESS] || 0,
    submitted: byStatus[designTaskStatuses.SUBMITTED] || 0,
    approved: byStatus[designTaskStatuses.APPROVED] || 0,
    rejected: byStatus[designTaskStatuses.REJECTED] || 0,
    cancelled: byStatus[designTaskStatuses.CANCELLED] || 0,
    unassigned: workload.totals?.unassignedCount || 0,
    active: workload.totals?.activeCount || 0,
    byStatus,
    byTaskType: workload.totals?.byTaskType || {},
    byDesigner: workload.byDesigner || [],
  };
}

async function getAssignees(query = {}, authContext) {
  const { search, ...taskQuery } = normalizeQueryAliases(query);
  const accessFilter = applyReadAccessFilter(taskQuery, authContext);
  const [profiles, counts] = await Promise.all([
    authPublic.listAssignableProfiles({ search, limit: 100 }),
    repository.countActiveByDesigner(accessFilter),
  ]);
  const countByAccountId = Object.fromEntries((counts || [])
    .map((row) => [String(row.assignedDesignerId), row.activeTaskCount || 0]));

  return {
    items: (profiles || []).map((profile) => {
      const accountId = toId(profile.accountId);
      return {
        id: accountId,
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl || null,
        activeTaskCount: countByAccountId[accountId] || 0,
      };
    }),
  };
}

function toCatalogCandidateQuery(query = {}) {
  const {
    search,
    shopId,
    shopIds,
    salesChannelCode,
    marketplaceCode,
    productTypeGroupId,
    page,
    limit,
  } = normalizeQueryAliases(query);
  return {
    search,
    shopId,
    shopIds,
    salesChannelCode,
    marketplaceCode,
    productTypeGroupId,
    psdStatus: PSD_MISSING_STATUS,
    page,
    limit,
  };
}

async function listPsdTemplateCandidates(query = {}, authContext) {
  const accessFilter = applyReadAccessFilter(query, authContext);
  const result = await catalogPublic.listListings(toCatalogCandidateQuery(accessFilter), {
    ...(authContext || {}),
    system: true,
    source: 'DESIGN',
  });
  const listingIds = uniqueIds((result.items || []).map((listing) => listing.id));
  const activeIds = new Set(await repository.findActiveListingIdsByType(listingIds, designTaskTypes.PSD_TEMPLATE));
  const items = (result.items || [])
    .filter((listing) => !activeIds.has(String(listing.id)))
    .map((listing) => ({ ...listing, hasActivePsdTask: false }));

  return {
    items,
    pagination: {
      ...(result.pagination || {}),
      total: items.length,
    },
  };
}

async function createTask(payload = {}, authContext) {
  assertTaskPayload(payload);
  assertValidObjectId(payload.listingId, 'listingId');
  const listing = await catalogPublic.getListingById(payload.listingId);
  if (!listing) throw notFound('Listing not found');
  assertCanAccessShop(listing.shopId, designPermissions.WRITE, authContext);

  if (payload.sourceListingId) {
    assertValidObjectId(payload.sourceListingId, 'sourceListingId');
    const sourceListing = await catalogPublic.getListingById(payload.sourceListingId);
    if (!sourceListing) throw notFound('Source listing not found');
    assertCanAccessShop(sourceListing.shopId, designPermissions.READ, authContext);
  }

  if (payload.sourceInternalTemplateId) {
    assertValidObjectId(payload.sourceInternalTemplateId, 'sourceInternalTemplateId');
    const sourceTemplate = await catalogPublic.getInternalTemplateById(payload.sourceInternalTemplateId);
    if (!sourceTemplate) throw notFound('Source internal template not found');
  }

  const referenceAssetIds = await assertMediaAssetsExist(payload.referenceAssetIds);

  const existing = await repository.findActiveByListingAndType(payload.listingId, payload.taskType);
  if (existing) throw conflict('Active design task already exists for this listing and task type');

  const snapshots = await buildTaskSnapshot(listing);
  const taskPayload = {
    listingId: payload.listingId,
    shopId: pickId(listing.shopId),
    productTypeGroupId: pickId(listing.productTypeGroupId),
    internalTemplateId: pickId(listing.internalTemplateId),
    targetListingId: payload.listingId,
    sourceListingId: payload.sourceListingId || null,
    sourceInternalTemplateId: payload.sourceInternalTemplateId || null,
    taskType: payload.taskType,
    brief: payload.brief || null,
    referenceAssetIds,
    expectedOutputs: payload.expectedOutputs || [],
    priority: payload.priority || designTaskPriorities.NORMAL,
    status: designTaskStatuses.REQUESTED,
    note: payload.note || null,
    ...snapshots,
  };

  try {
    return toDesignTaskDto(await repository.create(taskPayload), { detail: true });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw conflict('Active design task already exists for this listing and task type');
    }
    throw error;
  }
}

async function createPsdTemplateTaskFromListingWithStatus(listingId, payload = {}, authContext) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await catalogPublic.getListingById(listingId);
  if (!listing) throw notFound('Listing not found');
  assertCanAccessShop(listing.shopId, designPermissions.WRITE, authContext);
  if (listing.psdStatus !== PSD_MISSING_STATUS) {
    throw conflict('Listing PSD is not missing', { psdStatus: listing.psdStatus || null });
  }

  const existing = await repository.findActiveByListingAndType(listingId, designTaskTypes.PSD_TEMPLATE);
  if (existing) return { status: 'EXISTING', task: toDesignTaskDto(existing, { detail: true }) };

  const snapshots = await buildTaskSnapshot(listing);
  const taskPayload = {
    listingId,
    shopId: pickId(listing.shopId),
    productTypeGroupId: pickId(listing.productTypeGroupId),
    internalTemplateId: pickId(listing.internalTemplateId),
    targetListingId: listingId,
    taskType: designTaskTypes.PSD_TEMPLATE,
    priority: designTaskPriorities.NORMAL,
    status: designTaskStatuses.REQUESTED,
    note: payload.note || null,
    ...snapshots,
  };

  try {
    return { status: 'CREATED', task: toDesignTaskDto(await repository.create(taskPayload), { detail: true }) };
  } catch (error) {
    if (isDuplicateKey(error)) {
      return {
        status: 'EXISTING',
        task: toDesignTaskDto(
          await repository.findActiveByListingAndType(listingId, designTaskTypes.PSD_TEMPLATE),
          { detail: true },
        ),
      };
    }
    throw error;
  }
}

async function createPsdTemplateTaskFromListing(listingId, payload = {}, authContext) {
  const result = await createPsdTemplateTaskFromListingWithStatus(listingId, payload, authContext);
  return result.task;
}

function toBulkItem(listingId, status, taskOrError = {}) {
  return {
    listingId: String(listingId),
    status,
    ...(taskOrError?.id ? { taskId: taskOrError.id } : {}),
    ...(taskOrError?.message ? { message: taskOrError.message } : {}),
  };
}

async function resolveBulkListingIds(payload = {}, authContext) {
  if (payload.listingIds) return uniqueIds(payload.listingIds);
  const limit = Math.min(Number(payload.limit || BULK_PSD_MAX_LIMIT), BULK_PSD_MAX_LIMIT);
  const result = await catalogPublic.listListings({
    ...(payload.filters || {}),
    psdStatus: PSD_MISSING_STATUS,
    page: 1,
    limit,
  }, authContext);
  return uniqueIds((result.items || []).map((listing) => listing.id));
}

async function bulkCreatePsdTasksFromListings(payload = {}, authContext) {
  const listingIds = await resolveBulkListingIds(payload, authContext);
  const items = [];

  for (const listingId of listingIds) {
    try {
      const { status, task } = await createPsdTemplateTaskFromListingWithStatus(
        listingId,
        { note: payload.note },
        authContext,
      );
      items.push(toBulkItem(listingId, status, task));
    } catch (error) {
      items.push(toBulkItem(
        listingId,
        error.code === errorCodes.CONFLICT_ERROR ? 'SKIPPED' : 'FAILED',
        error,
      ));
    }
  }

  return {
    checked: items.length,
    created: items.filter((item) => item.status === 'CREATED').length,
    existing: items.filter((item) => item.status === 'EXISTING').length,
    skipped: items.filter((item) => item.status === 'SKIPPED').length,
    items,
  };
}

async function recheckProductionAfterPsdApproval(task, authContext = {}) {
  try {
    const targets = await productionPublic.listPsdBlockedTasksByListing(task.targetListingId || task.listingId);
    const results = await Promise.allSettled((targets || []).map((target) => (
      productionPublic.createOrRecheckTaskForOrderItem(target.orderItemId, {
        system: true,
        source: 'DESIGN_TASK',
        accountId: authContext?.accountId || null,
      })
    )));
    return results
      .map((result, index) => (result.status === 'rejected' ? {
        code: 'PRODUCTION_RECHECK_FAILED',
        productionTaskId: targets[index]?.id || null,
        orderItemId: targets[index]?.orderItemId || null,
        message: result.reason?.message || 'Production recheck failed',
      } : null))
      .filter(Boolean);
  } catch (error) {
    return [{
      code: 'PRODUCTION_RECHECK_FAILED',
      productionTaskId: null,
      orderItemId: null,
      message: error.message || 'Production recheck failed',
    }];
  }
}

async function assignTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  assertStatus(task, [designTaskStatuses.REQUESTED, designTaskStatuses.OPEN, designTaskStatuses.ASSIGNED], 'assigned');
  return toDesignTaskDto(await repository.updateById(taskId, {
    assignedDesignerId: payload.assignedDesignerId,
    assignedAt: task.assignedAt || new Date(),
    note: Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note || null : task.note || null,
    status: designTaskStatuses.ASSIGNED,
  }), { detail: true });
}

async function startTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanWorkTask(task, authContext);
  assertStatus(task, [designTaskStatuses.ASSIGNED], 'started');
  return toDesignTaskDto(await repository.updateById(taskId, {
    note: Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note || null : task.note || null,
    startedAt: task.startedAt || new Date(),
    status: designTaskStatuses.IN_PROGRESS,
  }), { detail: true });
}

async function submitTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanWorkTask(task, authContext);
  assertStatus(task, [designTaskStatuses.IN_PROGRESS, designTaskStatuses.REJECTED], 'submitted');
  const submittedAssetIds = uniqueIds(payload.submittedAssetIds);
  if (!submittedAssetIds.length) throw validationError('submittedAssetIds is required');
  await assertMediaAssetsExist(submittedAssetIds);
  const submissions = getSubmissions(task);
  const submittedAt = new Date();

  return toDesignTaskDto(await repository.updateById(taskId, {
    submittedAssetIds,
    submittedBy: authContext?.accountId || null,
    submittedAt,
    note: Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note || null : task.note || null,
    rejectReason: null,
    submissions: [
      ...submissions,
      {
        version: nextSubmissionVersion(submissions),
        assetIds: submittedAssetIds,
        submittedBy: authContext?.accountId || null,
        submittedAt,
        note: payload.note || null,
        status: designTaskSubmissionStatuses.SUBMITTED,
      },
    ],
    status: designTaskStatuses.SUBMITTED,
  }), { detail: true });
}

async function approveTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanReviewTask(task, authContext);
  assertStatus(task, [designTaskStatuses.SUBMITTED], 'approved');
  const approvedAssetId = String(payload.approvedAssetId || '');
  const submissions = getSubmissions(task);
  const submission = selectSubmittedSubmission(submissions, payload);
  if (!(submission.assetIds || []).map(String).includes(approvedAssetId)) {
    throw validationError('approvedAssetId must be one of submittedAssetIds');
  }

  let shouldUpdateListingPsd = task.taskType === designTaskTypes.PSD_TEMPLATE
    || (
      task.taskType === designTaskTypes.CLONE
      && (task.expectedOutputs || []).includes(designTaskOutputTypes.PSD_TEMPLATE)
    );
  if (!shouldUpdateListingPsd && task.taskType === designTaskTypes.CLONE) {
    shouldUpdateListingPsd = isPsdLikeAsset(await mediaPublic.getAsset(approvedAssetId));
  }
  const targetListingId = task.targetListingId || task.listingId;

  if (shouldUpdateListingPsd) {
    await catalogPublic.setListingPsdTemplateAsset(targetListingId, approvedAssetId, {
      source: 'DESIGN_TASK',
      taskId,
      accountId: authContext?.accountId || null,
    });
  }

  const approvedAt = new Date();
  const updated = await repository.updateById(taskId, {
    approvedAssetId,
    approvedBy: authContext?.accountId || null,
    approvedAt,
    submissions: updateSubmission(submissions, submission, {
      status: designTaskSubmissionStatuses.APPROVED,
      approvedAssetId,
      approvedBy: authContext?.accountId || null,
      approvedAt,
    }),
    status: designTaskStatuses.APPROVED,
  });
  const submissionId = toId(submission._id || submission.id);
  const updatedSubmission = getSubmissions(updated).find((candidate) => (
    submissionId
      ? toId(candidate._id || candidate.id) === submissionId
      : Number(candidate.version) === Number(submission.version)
  ));
  const score = updatedSubmission?.status === designTaskSubmissionStatuses.APPROVED
    ? await scoreService.scoreApprovedSubmission(updated, updatedSubmission, authContext)
    : null;
  const updatedSubmissionId = toId(updatedSubmission?._id || updatedSubmission?.id);
  const scoresBySubmissionId = updatedSubmissionId
    ? mapById(await scoreRepository.findBySubmissionIds([updatedSubmissionId]), (item) => item.submissionId)
    : {};
  if (score && updatedSubmissionId) {
    scoresBySubmissionId[updatedSubmissionId] = score;
  }
  const dto = toDesignTaskDto(updated, { detail: true, includeScores: true, scoresBySubmissionId });

  if (shouldUpdateListingPsd) {
    const warnings = await recheckProductionAfterPsdApproval(task, authContext);
    if (warnings.length) dto.warnings = warnings;
  }

  return dto;
}

async function resolveActivePsdTaskForListing(listingId, assetId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  assertValidObjectId(assetId, 'assetId');
  await mediaPublic.assertMediaAssetExists(assetId);

  const task = await repository.findActiveByListingAndType(listingId, designTaskTypes.PSD_TEMPLATE);
  if (!task) {
    return { resolved: false, reason: 'NO_ACTIVE_TASK' };
  }

  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  const approvedAt = new Date();
  const submissions = getSubmissions(task);
  const submitted = [...submissions].reverse().find((submission) => (
    submission.status === designTaskSubmissionStatuses.SUBMITTED
    && (submission.assetIds || []).map(String).includes(String(assetId))
  ));
  const nextSubmissions = submitted
    ? updateSubmission(submissions, submitted, {
      status: designTaskSubmissionStatuses.APPROVED,
      approvedAssetId: assetId,
      approvedBy: authContext?.accountId || null,
      approvedAt,
    })
    : [
      ...submissions,
      normalizeSubmission({
        version: nextSubmissionVersion(submissions),
        assetIds: [assetId],
        submittedBy: authContext?.accountId || null,
        submittedAt: approvedAt,
        note: 'Resolved by listing PSD upload',
        status: designTaskSubmissionStatuses.APPROVED,
        approvedAssetId: assetId,
        approvedBy: authContext?.accountId || null,
        approvedAt,
      }),
    ];

  const updated = await repository.updateById(task._id || task.id, {
    submittedAssetIds: [assetId],
    submittedBy: authContext?.accountId || null,
    submittedAt: approvedAt,
    approvedAssetId: assetId,
    approvedBy: authContext?.accountId || null,
    approvedAt,
    rejectReason: null,
    submissions: nextSubmissions,
    status: designTaskStatuses.APPROVED,
  });

  return {
    resolved: true,
    taskId: toId(updated._id || updated.id),
    status: updated.status,
  };
}

async function rejectTask(taskId, payload = {}, authContext) {
  const rejectReason = String(payload.rejectReason || '').trim();
  if (!rejectReason) throw validationError('rejectReason is required');
  const task = await loadTask(taskId);
  assertCanReviewTask(task, authContext);
  assertStatus(task, [designTaskStatuses.SUBMITTED], 'rejected');
  const submissions = getSubmissions(task);
  const submission = selectSubmittedSubmission(submissions, payload);
  const rejectedAt = new Date();

  return toDesignTaskDto(await repository.updateById(taskId, {
    rejectedBy: authContext?.accountId || null,
    rejectedAt,
    rejectReason,
    submissions: updateSubmission(submissions, submission, {
      status: designTaskSubmissionStatuses.REJECTED,
      rejectedBy: authContext?.accountId || null,
      rejectedAt,
      rejectReason,
    }),
    status: designTaskStatuses.REJECTED,
  }), { detail: true });
}

async function removeSubmission(taskId, submissionId, authContext) {
  assertValidObjectId(submissionId, 'submissionId');
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  const submissions = getSubmissions(task);
  const submission = submissions.find((item) => String(item._id || item.id) === String(submissionId));
  if (!submission) throw notFound('Submission not found');
  if (submission.status === designTaskSubmissionStatuses.APPROVED) {
    throw conflict('Approved submission cannot be removed');
  }
  return toDesignTaskDto(await repository.updateById(taskId, {
    submissions: updateSubmission(submissions, submission, {
      status: designTaskSubmissionStatuses.REMOVED,
      removedBy: authContext?.accountId || null,
      removedAt: new Date(),
    }),
  }), { detail: true });
}

async function cancelTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  assertStatus(task, [
    designTaskStatuses.OPEN,
    designTaskStatuses.REQUESTED,
    designTaskStatuses.ASSIGNED,
    designTaskStatuses.IN_PROGRESS,
    designTaskStatuses.SUBMITTED,
    designTaskStatuses.REJECTED,
  ], 'cancelled');
  return toDesignTaskDto(await repository.updateById(taskId, {
    cancelledBy: authContext?.accountId || null,
    cancelledAt: new Date(),
    note: payload.cancelReason || task.note || null,
    status: designTaskStatuses.CANCELLED,
  }), { detail: true });
}

module.exports = {
  approveTask,
  assignTask,
  bulkCreatePsdTasksFromListings,
  cancelTask,
  createPsdTemplateTaskFromListing,
  createTask,
  getAssignees,
  getTask,
  getWorkload,
  listSubmissions,
  listSubmissionScores,
  listPsdFiles,
  listPsdTemplateCandidates,
  listTasks,
  removeSubmission,
  rejectTask,
  resolveActivePsdTaskForListing,
  startTask,
  submitTask,
  summarizeTasks,
};
