const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const mediaPublic = require('../../media/public');
const productionPublic = require('../../production/public');
const {
  designPermissions,
  designTaskOutputTypes,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');
const repository = require('../repositories/designTask.repository');
const { toDesignTaskDto, toId, toPaginatedResponse } = require('../dtos/designTask.dto');

const SHOP_SCOPE_TYPE = 'shop';
const PSD_MISSING_STATUS = 'MISSING';
const BULK_PSD_MAX_LIMIT = 100;

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

function scopedShopIds(authContext = {}, permissions = []) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => scope.scopeType === SHOP_SCOPE_TYPE)
    .filter((scope) => permissions.some((permission) => (scope.permissions || []).includes(permission)))
    .map((scope) => String(scope.scopeId))
    .filter(Boolean))];
}

function assertCanAccessShop(shopId, permission, authContext = {}) {
  if (hasGlobalPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function assertCanAccessShopAny(shopId, permissions, authContext = {}) {
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
  return hasPermission(authContext, designPermissions.READ);
}

function assertCanReadTask(task, authContext = {}) {
  if (hasFullRead(authContext)) {
    assertCanAccessShopAny(task.shopId, [designPermissions.READ, designPermissions.WRITE], authContext);
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
  if (hasFullRead(authContext)) {
    if (query.shopId) assertCanAccessShop(query.shopId, designPermissions.READ, authContext);
    if (!hasGlobalPermission(authContext, designPermissions.READ) && !query.shopId) {
      return {
        ...query,
        shopIds: scopedShopIds(authContext, [designPermissions.READ, designPermissions.WRITE]),
      };
    }
    return query;
  }

  if (!hasPermission(authContext, designPermissions.WORK) || !authContext.accountId) throw forbidden();
  if (query.shopId) assertCanAccessShop(query.shopId, designPermissions.WORK, authContext);
  return {
    ...query,
    assignedDesignerId: authContext.accountId,
    ...(!hasGlobalPermission(authContext, designPermissions.WORK) && !query.shopId
      ? { shopIds: scopedShopIds(authContext, [designPermissions.WORK]) }
      : {}),
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

async function listTasks(query = {}, authContext) {
  const result = await repository.list(applyReadAccessFilter(query, authContext));
  if (authContext) {
    result.items.forEach((task) => assertCanReadTask(task, authContext));
  }
  return toPaginatedResponse(result);
}

async function getTask(taskId, authContext) {
  const task = await loadTask(taskId);
  assertCanReadTask(task, authContext);
  return toDesignTaskDto(task, { detail: true });
}

async function getWorkload(query = {}, authContext) {
  return repository.getWorkload(applyReadAccessFilter(query, authContext));
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
    status: designTaskStatuses.OPEN,
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
    status: designTaskStatuses.OPEN,
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
  assertStatus(task, [designTaskStatuses.OPEN, designTaskStatuses.ASSIGNED], 'assigned');
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

  return toDesignTaskDto(await repository.updateById(taskId, {
    submittedAssetIds,
    submittedBy: authContext?.accountId || null,
    submittedAt: new Date(),
    note: Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note || null : task.note || null,
    rejectReason: null,
    status: designTaskStatuses.SUBMITTED,
  }), { detail: true });
}

async function approveTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanReviewTask(task, authContext);
  assertStatus(task, [designTaskStatuses.SUBMITTED], 'approved');
  const approvedAssetId = String(payload.approvedAssetId || '');
  if (!(task.submittedAssetIds || []).map(String).includes(approvedAssetId)) {
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

  const updated = await repository.updateById(taskId, {
    approvedAssetId,
    approvedBy: authContext?.accountId || null,
    approvedAt: new Date(),
    status: designTaskStatuses.APPROVED,
  });
  const dto = toDesignTaskDto(updated, { detail: true });

  if (shouldUpdateListingPsd) {
    const warnings = await recheckProductionAfterPsdApproval(task, authContext);
    if (warnings.length) dto.warnings = warnings;
  }

  return dto;
}

async function rejectTask(taskId, payload = {}, authContext) {
  const rejectReason = String(payload.rejectReason || '').trim();
  if (!rejectReason) throw validationError('rejectReason is required');
  const task = await loadTask(taskId);
  assertCanReviewTask(task, authContext);
  assertStatus(task, [designTaskStatuses.SUBMITTED], 'rejected');

  return toDesignTaskDto(await repository.updateById(taskId, {
    rejectedBy: authContext?.accountId || null,
    rejectedAt: new Date(),
    rejectReason,
    status: designTaskStatuses.REJECTED,
  }), { detail: true });
}

async function cancelTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  assertStatus(task, [
    designTaskStatuses.OPEN,
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
  getTask,
  getWorkload,
  listTasks,
  rejectTask,
  startTask,
  submitTask,
};
