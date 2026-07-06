const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const productionPublic = require('../../production/public');
const {
  vendorSubmissionPermissions,
  vendorSubmissionStatuses,
} = require('../constants/vendorSubmission.constants');
const repository = require('../repositories/vendorSubmission.repository');
const {
  stripUnsafe,
  toPaginatedResponse,
  toPayloadPreviewDto,
  toVendorSubmissionDto,
} = require('../dtos/vendorSubmission.dto');

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
    permission === vendorSubmissionPermissions.READ
    && permissions.includes(vendorSubmissionPermissions.WRITE)
  );
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function isDuplicateKey(error) {
  return error && error.code === 11000;
}

function snapshotFromTask(task) {
  return stripUnsafe({
    orderItem: task.orderItem || null,
    listing: task.listing || null,
    internalTemplate: task.internalTemplate || null,
    vendorProduct: task.vendorProduct || null,
    vendorCostCenter: task.vendorCostCenter || null,
    fulfillQty: task.fulfillQty || 1,
    fileChecks: task.fileChecks || [],
    production: {
      taskId: task.id,
      status: task.status,
      scaleStatus: task.scaleStatus,
      qcStatus: task.qcStatus,
      blockers: task.blockers || [],
      readyAt: task.readyAt || null,
    },
  });
}

async function loadSubmission(submissionId) {
  assertValidObjectId(submissionId, 'submissionId');
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Vendor submission not found');
  return submission;
}

async function listSubmissions(query = {}, authContext) {
  const result = await repository.list(query);
  if (authContext) {
    result.items.forEach((submission) => assertCanAccessShop(
      submission.shopId,
      vendorSubmissionPermissions.READ,
      authContext,
    ));
  }
  return toPaginatedResponse(result);
}

async function getSubmission(submissionId, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.READ, authContext);
  return toVendorSubmissionDto(submission, { detail: true });
}

async function createFromProductionTask(productionTaskId, authContext) {
  assertValidObjectId(productionTaskId, 'productionTaskId');
  const task = await productionPublic.getTaskById(productionTaskId);
  if (!task) throw notFound('Production task not found');
  assertCanAccessShop(task.shopId, vendorSubmissionPermissions.WRITE, authContext);

  if (task.status !== 'READY_TO_SEND_VENDOR') {
    throw conflict('Production task is not ready to send vendor', { status: task.status });
  }

  const existing = await repository.findActiveByProductionTask(productionTaskId);
  if (existing) return toVendorSubmissionDto(existing, { detail: true });

  const payload = {
    productionTaskId,
    orderId: task.orderId,
    orderItemId: task.orderItemId,
    shopId: task.shopId,
    fulfillmentPlanId: task.fulfillmentPlanId || null,
    vendorProductId: task.vendorProduct?.id || null,
    vendorCostCenterId: task.vendorCostCenter?.id || null,
    status: vendorSubmissionStatuses.READY,
    payloadSnapshot: snapshotFromTask(task),
  };

  try {
    return toVendorSubmissionDto(await repository.create(payload), { detail: true });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const duplicate = await repository.findActiveByProductionTask(productionTaskId);
      if (duplicate) return toVendorSubmissionDto(duplicate, { detail: true });
      throw conflict('Vendor submission already exists for production task');
    }
    throw error;
  }
}

async function getPayloadPreview(submissionId, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.READ, authContext);
  return toPayloadPreviewDto(submission.payloadSnapshot || {});
}

async function markSubmitted(submissionId, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  if (submission.status === vendorSubmissionStatuses.SUBMITTED) {
    return toVendorSubmissionDto(submission, { detail: true });
  }
  if (submission.status !== vendorSubmissionStatuses.READY) {
    throw conflict('Vendor submission is not ready to submit', { status: submission.status });
  }

  const updated = await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.SUBMITTED,
    submittedBy: authContext?.accountId || null,
    submittedAt: new Date(),
  });
  await productionPublic.markSentToVendor(String(submission.productionTaskId), submissionId, authContext);
  return toVendorSubmissionDto(updated, { detail: true });
}

async function markFailed(submissionId, payload = {}, authContext) {
  const reason = String(payload.failureReason || '').trim();
  if (!reason) throw validationError('failureReason is required', { field: 'failureReason' });

  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  if (![vendorSubmissionStatuses.READY, vendorSubmissionStatuses.SUBMITTED].includes(submission.status)) {
    throw conflict('Vendor submission cannot be marked failed from current status', { status: submission.status });
  }

  return toVendorSubmissionDto(await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.FAILED,
    failedBy: authContext?.accountId || null,
    failedAt: new Date(),
    failureReason: reason,
  }), { detail: true });
}

async function cancel(submissionId, payload = {}, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  if (submission.status === vendorSubmissionStatuses.CANCELLED) {
    return toVendorSubmissionDto(submission, { detail: true });
  }
  if (submission.status === vendorSubmissionStatuses.SUBMITTED) {
    throw conflict('Submitted vendor submission cannot be cancelled', { status: submission.status });
  }

  return toVendorSubmissionDto(await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.CANCELLED,
    cancelledBy: authContext?.accountId || null,
    cancelledAt: new Date(),
    cancelReason: payload.cancelReason ? String(payload.cancelReason).trim() : null,
  }), { detail: true });
}

async function getByProductionTaskId(productionTaskId) {
  assertValidObjectId(productionTaskId, 'productionTaskId');
  return toVendorSubmissionDto(await repository.findByProductionTaskId(productionTaskId), { detail: true });
}

async function getByOrderItemId(orderItemId) {
  assertValidObjectId(orderItemId, 'orderItemId');
  return toVendorSubmissionDto(await repository.findByOrderItemId(orderItemId), { detail: true });
}

module.exports = {
  cancel,
  createFromProductionTask,
  getByOrderItemId,
  getByProductionTaskId,
  getPayloadPreview,
  getSubmission,
  listSubmissions,
  markFailed,
  markSubmitted,
};
