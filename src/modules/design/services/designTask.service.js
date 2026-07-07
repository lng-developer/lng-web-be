const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const mediaPublic = require('../../media/public');
const {
  designPermissions,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');
const repository = require('../repositories/designTask.repository');
const { toDesignTaskDto, toId, toPaginatedResponse } = require('../dtos/designTask.dto');

const SHOP_SCOPE_TYPE = 'shop';

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
  const permissions = authContext.permissions || [];
  return permissions.includes(permission) || (
    permission === designPermissions.READ
    && permissions.includes(designPermissions.WRITE)
  );
}

function assertCanAccessShop(shopId, permission, authContext = {}) {
  if (hasPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function isDuplicateKey(error) {
  return error && error.code === 11000;
}

function pickId(value) {
  return toId(value);
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
  const result = await repository.list(query);
  if (authContext) {
    result.items.forEach((task) => assertCanAccessShop(task.shopId, designPermissions.READ, authContext));
  }
  return toPaginatedResponse(result);
}

async function getTask(taskId, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, designPermissions.READ, authContext);
  return toDesignTaskDto(task, { detail: true });
}

async function createTask(payload = {}, authContext) {
  assertValidObjectId(payload.listingId, 'listingId');
  const listing = await catalogPublic.getListingById(payload.listingId);
  if (!listing) throw notFound('Listing not found');
  assertCanAccessShop(listing.shopId, designPermissions.WRITE, authContext);

  const existing = await repository.findActiveByListingAndType(payload.listingId, payload.taskType);
  if (existing) throw conflict('Active design task already exists for this listing and task type');

  const snapshots = await buildTaskSnapshot(listing);
  const taskPayload = {
    listingId: payload.listingId,
    shopId: pickId(listing.shopId),
    productTypeGroupId: pickId(listing.productTypeGroupId),
    internalTemplateId: pickId(listing.internalTemplateId),
    taskType: payload.taskType,
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
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  assertStatus(task, [designTaskStatuses.ASSIGNED], 'started');
  return toDesignTaskDto(await repository.updateById(taskId, {
    note: Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note || null : task.note || null,
    startedAt: task.startedAt || new Date(),
    status: designTaskStatuses.IN_PROGRESS,
  }), { detail: true });
}

async function submitTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  assertStatus(task, [designTaskStatuses.IN_PROGRESS, designTaskStatuses.REJECTED], 'submitted');
  const submittedAssetIds = [...new Set((payload.submittedAssetIds || []).map(String))];
  if (!submittedAssetIds.length) throw validationError('submittedAssetIds is required');
  await Promise.all(submittedAssetIds.map((mediaAssetId) => mediaPublic.assertMediaAssetExists(mediaAssetId)));

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
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
  assertStatus(task, [designTaskStatuses.SUBMITTED], 'approved');
  const approvedAssetId = String(payload.approvedAssetId || '');
  if (!(task.submittedAssetIds || []).map(String).includes(approvedAssetId)) {
    throw validationError('approvedAssetId must be one of submittedAssetIds');
  }

  if (task.taskType === designTaskTypes.PSD_TEMPLATE) {
    await catalogPublic.setListingPsdTemplateAsset(task.listingId, approvedAssetId, {
      source: 'DESIGN_TASK',
      taskId,
      accountId: authContext?.accountId || null,
    });
  }

  return toDesignTaskDto(await repository.updateById(taskId, {
    approvedAssetId,
    approvedBy: authContext?.accountId || null,
    approvedAt: new Date(),
    status: designTaskStatuses.APPROVED,
  }), { detail: true });
}

async function rejectTask(taskId, payload = {}, authContext) {
  const rejectReason = String(payload.rejectReason || '').trim();
  if (!rejectReason) throw validationError('rejectReason is required');
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, designPermissions.WRITE, authContext);
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
  cancelTask,
  createTask,
  getTask,
  listTasks,
  rejectTask,
  startTask,
  submitTask,
};
