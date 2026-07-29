const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const authPublic = require('../../auth/public');
const notificationPublic = require('../../notification/public');
const orderPublic = require('../../order/public');
const productionPublic = require('../../production/public');
const submitRegistry = require('./submitAdapters/registry');
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
  if (authContext?.system) return;
  if (!authContext || hasPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function scopedShopIds(authContext = {}, permission) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(permission)
    ))
    .map((scope) => String(scope.scopeId)))];
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

function statusHistoryEntry(status, authContext, reason = null) {
  return {
    status,
    actorId: authContext?.accountId || null,
    reason,
    at: new Date(),
  };
}

function appendStatusHistory(submission = {}, status, authContext, reason = null) {
  return [
    ...(submission.statusHistory || []),
    statusHistoryEntry(status, authContext, reason),
  ];
}

async function notifyOrderOwnerOfFailure(submission) {
  const submissionId = String(submission._id || submission.id);
  try {
    const order = await orderPublic.findById(submission.orderId);
    if (!order?.assignedStaffId) return;
    const recipientAccountId = String(order.assignedStaffId);
    const version = submission.updatedAt ? new Date(submission.updatedAt).toISOString() : 'unknown';
    await notificationPublic.notify({
      recipientAccountId,
      type: 'VENDOR_SUBMISSION_FAILED',
      title: 'Vendor submission failed',
      message: 'A vendor submission for your order failed and needs attention.',
      relatedResource: { type: 'vendorSubmission', id: submissionId },
      deduplicationKey: `VENDOR_SUBMISSION_FAILED:${submissionId}:${recipientAccountId}:${version}`,
    });
  } catch (error) {
    logger.warn('vendor_submission_notification_failed', {
      submissionId,
      errorCode: error.code || errorCodes.INTERNAL_SERVER_ERROR,
    });
  }
}

async function loadSubmission(submissionId) {
  assertValidObjectId(submissionId, 'submissionId');
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Vendor submission not found');
  return submission;
}

async function listSubmissions(query = {}, authContext) {
  const scopedQuery = authContext ? scopedReadQuery(query, authContext) : query;
  if (!scopedQuery) {
    return toPaginatedResponse({
      items: [],
      total: 0,
      page: query.page || 1,
      limit: query.limit || 20,
    });
  }
  return toPaginatedResponse(await repository.list(scopedQuery));
}

async function listSubmittedForTracking(query = {}, authContext) {
  const listQuery = {
    provider: query.provider ? String(query.provider).trim().toUpperCase() : undefined,
    limit: Math.min(Math.max(Number(query.limit) || 50, 1), 100),
  };

  if (query.shopId) {
    assertCanAccessShop(query.shopId, vendorSubmissionPermissions.WRITE, authContext);
    listQuery.shopId = query.shopId;
  } else if (Array.isArray(query.shopIds) && query.shopIds.length) {
    listQuery.shopIds = query.shopIds;
  } else if (!authContext?.system && !hasPermission(authContext, vendorSubmissionPermissions.WRITE)) {
    const shopIds = scopedShopIds(authContext, vendorSubmissionPermissions.WRITE);
    if (!shopIds.length) return [];
    listQuery.shopIds = shopIds;
  }

  const rows = await repository.listSubmittedForTracking(listQuery);
  return rows.map((row) => ({
    id: String(row._id || row.id),
    shopId: String(row.shopId),
    orderItemId: String(row.orderItemId),
    provider: row.provider || null,
    vendorExternalOrderId: row.vendorExternalOrderId || null,
  }));
}

function scopedReadQuery(query = {}, authContext = {}) {
  if (authContext?.system) return query;
  if (query.shopId) {
    assertCanAccessShop(query.shopId, vendorSubmissionPermissions.READ, authContext);
    return query;
  }
  if (hasPermission(authContext, vendorSubmissionPermissions.READ)) return query;
  const shopIds = scopedShopIds(authContext, vendorSubmissionPermissions.READ);
  return shopIds.length ? { ...query, shopIds } : null;
}

async function summarizeSubmissions(query = {}, authContext) {
  const scopedQuery = scopedReadQuery(query, authContext);
  if (!scopedQuery) {
    return {
      total: 0,
      ready: 0,
      submitted: 0,
      failed: 0,
      cancelled: 0,
      byStatus: {},
      byShop: [],
      byVendor: [],
    };
  }
  const summary = await repository.summarize(scopedQuery);
  return {
    total: summary.total || 0,
    ready: summary.byStatus?.[vendorSubmissionStatuses.READY] || 0,
    submitted: summary.byStatus?.[vendorSubmissionStatuses.SUBMITTED] || 0,
    failed: summary.byStatus?.[vendorSubmissionStatuses.FAILED] || 0,
    cancelled: summary.byStatus?.[vendorSubmissionStatuses.CANCELLED] || 0,
    byStatus: summary.byStatus || {},
    byShop: summary.byShop || [],
    byVendor: summary.byVendor || [],
  };
}

async function summarizePerformance(query = {}) {
  return repository.summarizePerformance(query);
}

async function summarizePerformancePage(query = {}) {
  return repository.summarizePerformancePage(query);
}

async function getSubmission(submissionId, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.READ, authContext);
  return toVendorSubmissionDto(submission, { detail: true });
}

async function createFromProductionTask(productionTaskId, authContext) {
  assertValidObjectId(productionTaskId, 'productionTaskId');
  const task = await productionPublic.getTaskById(productionTaskId, authContext);
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
    statusHistory: [
      statusHistoryEntry(vendorSubmissionStatuses.READY, authContext, 'Created from production task'),
    ],
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

async function recheckProductionTask(productionTaskId, authContext) {
  return createFromProductionTask(productionTaskId, authContext);
}

function baseRecheckQuery(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  if (query.shopId) assertValidObjectId(query.shopId, 'shopId');
  return {
    status: 'READY_TO_SEND_VENDOR',
    page: 1,
    limit,
  };
}

function recheckListQueries(query = {}, authContext) {
  const base = baseRecheckQuery(query);
  if (query.shopId) {
    assertCanAccessShop(query.shopId, vendorSubmissionPermissions.WRITE, authContext);
    return [{ ...base, shopId: query.shopId }];
  }
  if (hasPermission(authContext, vendorSubmissionPermissions.WRITE)) return [base];
  return scopedShopIds(authContext, vendorSubmissionPermissions.WRITE)
    .map((shopId) => ({ ...base, shopId }));
}

function compactRecheckError(productionTaskId, error) {
  return {
    productionTaskId,
    errorCode: error?.code || errorCodes.INTERNAL_SERVER_ERROR,
    reason: error?.message || 'Recheck failed',
  };
}

async function recheckReadyProductionTasks(query = {}, authContext) {
  const listQueries = recheckListQueries(query, authContext);
  const items = [];

  for (const listQuery of listQueries) {
    const tasks = await productionPublic.listTasks(listQuery, {
      ...(authContext || {}),
      system: true,
      source: 'VENDOR_SUBMISSION_RECHECK',
    });
    for (const task of tasks.items || []) {
      const productionTaskId = String(task.id || task._id || '');
      try {
        const submission = await createFromProductionTask(productionTaskId, authContext);
        items.push({
          productionTaskId,
          submissionId: submission.id,
          status: submission.status,
        });
      } catch (error) {
        items.push(compactRecheckError(productionTaskId, error));
      }
    }
  }

  const createdOrExisting = items.filter((item) => item.submissionId).length;
  return {
    checked: items.length,
    createdOrExisting,
    skipped: items.length - createdOrExisting,
    items,
  };
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
    statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.SUBMITTED, authContext),
  });
  try {
    await productionPublic.markSentToVendor(String(submission.productionTaskId), submissionId, {
      ...(authContext || {}),
      system: true,
      source: 'VENDOR_SUBMISSION',
    });
  } catch (error) {
    const sameSubmittedTask = error?.statusCode === httpStatus.CONFLICT
      && error?.details?.status === 'SENT_TO_VENDOR'
      && String(error?.details?.vendorSubmissionId || '') === String(submissionId);
    if (!sameSubmittedTask) throw error;
  }
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

  const updated = await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.FAILED,
    failedBy: authContext?.accountId || null,
    failedAt: new Date(),
    failureReason: reason,
    statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.FAILED, authContext, reason),
  });
  await notifyOrderOwnerOfFailure(updated);
  return toVendorSubmissionDto(updated, { detail: true });
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
    statusHistory: appendStatusHistory(
      submission,
      vendorSubmissionStatuses.CANCELLED,
      authContext,
      payload.cancelReason ? String(payload.cancelReason).trim() : null,
    ),
  }), { detail: true });
}

async function retry(submissionId, payload = {}, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  if (submission.status !== vendorSubmissionStatuses.FAILED) {
    throw conflict('Only failed vendor submissions can be retried', { status: submission.status });
  }
  const reason = payload.reason ? String(payload.reason).trim() : null;
  return toVendorSubmissionDto(await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.READY,
    failedAt: submission.failedAt || null,
    failureReason: submission.failureReason || null,
    statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.READY, authContext, reason),
  }), { detail: true });
}

async function submitToVendor(submissionId, payload = {}, authContext) {
  const dryRun = payload.dryRun !== false;
  const provider = String(payload.provider || '').trim().toUpperCase();
  const adapter = submitRegistry.getAdapter(provider);
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);

  if (submission.status !== vendorSubmissionStatuses.READY) {
    throw conflict('Vendor submission is not ready to submit', { status: submission.status });
  }

  const submitPayload = adapter.buildPayload(submission);
  adapter.validatePayload(submitPayload);

  if (dryRun) {
    return {
      provider: adapter.provider,
      dryRun: true,
      payload: stripUnsafe(submitPayload),
      validation: { ok: true },
    };
  }

  let submitResult;
  try {
    submitResult = await adapter.submitPayload(submitPayload);
  } catch (error) {
    if (error?.details?.response) {
      await repository.updateById(submissionId, {
        status: vendorSubmissionStatuses.FAILED,
        provider: adapter.provider,
        submittedResponse: stripUnsafe(error.details.response),
        failedBy: authContext?.accountId || null,
        failedAt: new Date(),
        failureReason: error.message || 'Vendor submit failed',
        statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.FAILED, authContext, error.message || 'Vendor submit failed'),
      });
    }
    throw error;
  }
  const updated = await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.SUBMITTED,
    provider: adapter.provider,
    vendorExternalOrderId: submitResult.externalId || null,
    submittedResponse: stripUnsafe(submitResult.response || null),
    submittedBy: authContext?.accountId || null,
    submittedAt: new Date(),
    statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.SUBMITTED, authContext, `Submitted to ${adapter.provider}`),
  });

  try {
    await productionPublic.markSentToVendor(String(submission.productionTaskId), submissionId, {
      ...(authContext || {}),
      system: true,
      source: 'VENDOR_SUBMISSION',
    });
  } catch (error) {
    const sameSubmittedTask = error?.statusCode === httpStatus.CONFLICT
      && error?.details?.status === 'SENT_TO_VENDOR'
      && String(error?.details?.vendorSubmissionId || '') === String(submissionId);
    if (!sameSubmittedTask) throw error;
  }

  return toVendorSubmissionDto(updated, { detail: true });
}

async function listLatestByProductionTaskIds(productionTaskIds = [], authContext) {
  const ids = [...new Set((productionTaskIds || []).map(String).filter(Boolean))];
  ids.forEach((id) => assertValidObjectId(id, 'productionTaskId'));
  const submissions = await repository.listLatestByProductionTaskIds(ids);
  if (authContext) {
    submissions.forEach((submission) => assertCanAccessShop(
      submission.shopId,
      vendorSubmissionPermissions.READ,
      authContext,
    ));
  }
  return submissions.map((submission) => toVendorSubmissionDto(submission, { detail: true }));
}

async function getByProductionTaskId(productionTaskId) {
  assertValidObjectId(productionTaskId, 'productionTaskId');
  return toVendorSubmissionDto(await repository.findByProductionTaskId(productionTaskId), { detail: true });
}

async function getByOrderItemId(orderItemId) {
  assertValidObjectId(orderItemId, 'orderItemId');
  return toVendorSubmissionDto(await repository.findByOrderItemId(orderItemId), { detail: true });
}

async function getByProviderExternalOrderId({ provider, vendorExternalOrderId } = {}) {
  const normalizedProvider = String(provider || '').trim().toUpperCase();
  const normalizedExternalOrderId = String(vendorExternalOrderId || '').trim();
  if (!normalizedProvider || !normalizedExternalOrderId) return null;
  return toVendorSubmissionDto(await repository.findByProviderExternalOrderId({
    provider: normalizedProvider,
    vendorExternalOrderId: normalizedExternalOrderId,
  }), { detail: true });
}

module.exports = {
  cancel,
  createFromProductionTask,
  getByOrderItemId,
  getByProviderExternalOrderId,
  getByProductionTaskId,
  getPayloadPreview,
  getSubmission,
  listSubmissions,
  listSubmittedForTracking,
  listLatestByProductionTaskIds,
  markFailed,
  markSubmitted,
  recheckProductionTask,
  recheckReadyProductionTasks,
  retry,
  submitToVendor,
  summarizePerformance,
  summarizePerformancePage,
  summarizeSubmissions,
};
