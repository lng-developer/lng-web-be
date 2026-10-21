const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const crypto = require('crypto');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const notificationPublic = require('../../notification/public');
const orderPublic = require('../../order/public');
const productionPublic = require('../../production/public');
const mediaPublic = require('../../media/public');
const vendorPublic = require('../../vendor/public');
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

async function attachVendorAssetUrls(fileChecks = []) {
  return Promise.all((fileChecks || []).map(async (check) => {
    const outputAssetId = check.outputAssetId || null;
    if (!outputAssetId) return check;
    return {
      ...check,
      outputVendorUrl: await mediaPublic.getPublicAssetUrl(outputAssetId),
    };
  }));
}

async function attachListingVendorUrl(listing) {
  if (!listing?.previewAssetId) return listing || null;
  return {
    ...listing,
    previewVendorUrl: await mediaPublic.getPublicAssetUrl(listing.previewAssetId),
  };
}

async function snapshotFromTask(task) {
  return stripUnsafe({
    orderItem: task.orderItem || null,
    listing: await attachListingVendorUrl(task.listing),
    internalTemplate: task.internalTemplate || null,
    vendorProduct: task.vendorProduct || null,
    vendorCostCenter: task.vendorCostCenter || null,
    fulfillQty: task.fulfillQty || 1,
    fileChecks: await attachVendorAssetUrls(task.fileChecks || []),
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

function auditSource(authContext = {}) {
  if (authContext.import) return 'IMPORT';
  if (authContext.worker) return 'WORKER';
  if (authContext.system) return 'SYSTEM';
  if (['HTTP', 'WORKER', 'SYSTEM', 'IMPORT'].includes(authContext.source)) return authContext.source;
  return 'HTTP';
}

function auditActor(authContext = {}) {
  const internal = authContext.system || authContext.worker || authContext.import;
  return {
    actorType: internal ? 'SYSTEM' : (authContext.accountId ? 'ACCOUNT' : 'SYSTEM'),
    actorAccountId: internal ? null : (authContext.accountId || null),
  };
}

function productionHandoffContext(authContext = {}) {
  return {
    ...authContext,
    system: true,
    source: 'VENDOR_SUBMISSION',
    auditActorType: auditActor(authContext).actorType,
    auditSource: auditSource(authContext),
  };
}

function auditMutationIdentity(entity = {}, authContext = {}) {
  const lastHistory = Array.isArray(entity.statusHistory) ? entity.statusHistory.at(-1) : null;
  const persistedTimestamp = entity.updatedAt
    || lastHistory?.at
    || entity.createdAt
    || entity.submittedAt
    || entity.failedAt
    || entity.cancelledAt;
  const internal = authContext.system || authContext.worker || authContext.import;
  const trustedOperationId = internal ? authContext.operationId : null;
  const material = Number.isInteger(entity.__v)
    ? `persisted-version:${entity.__v}`
    : persistedTimestamp
      ? `persisted-time:${new Date(persistedTimestamp).toISOString()}`
    : trustedOperationId
      ? `operation:${trustedOperationId}`
      : `persisted-state:${entity.status || 'unknown'}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function auditReasonProvided(value) {
  return Boolean(String(value || '').trim());
}

async function recordSubmissionOperation({ action, submission, authContext = {}, changes = null, metadata = {} }) {
  const entityId = String(submission._id || submission.id);
  try {
    await auditPublic.record({
      ...auditActor(authContext),
      actorSnapshot: {},
      action,
      entityType: 'VENDOR_SUBMISSION',
      entityId,
      scopeType: 'SHOP',
      scopeId: String(submission.shopId),
      outcome: 'SUCCEEDED',
      source: auditSource(authContext),
      requestId: authContext.auditContext?.requestId || null,
      ipAddress: authContext.auditContext?.ipAddress || null,
      userAgent: authContext.auditContext?.userAgent || null,
      changes,
      metadata,
      deduplicationKey: `operations:${action.toLowerCase()}:${entityId}:${auditMutationIdentity(submission, authContext)}`,
    }, {});
  } catch (error) {
    logger.warn('vendor_submission_audit_write_failed', { action, entityId, error });
  }
}

async function notifyOrderOwnerOfFailure(submission) {
  const submissionId = String(submission._id || submission.id);
  try {
    const order = await orderPublic.findById(submission.orderId);
    const recipients = [...new Set((order?.assignedStaffIds || []).filter(Boolean).map(String))];
    const version = submission.updatedAt ? new Date(submission.updatedAt).toISOString() : 'unknown';
    await Promise.all(recipients.map((recipientAccountId) => notificationPublic.notify({
      recipientAccountId,
      type: 'VENDOR_SUBMISSION_FAILED',
      title: 'Vendor submission failed',
      message: 'A vendor submission for your order failed and needs attention.',
      relatedResource: { type: 'vendorSubmission', id: submissionId },
      deduplicationKey: `VENDOR_SUBMISSION_FAILED:${submissionId}:${recipientAccountId}:${version}`,
    })));
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
  const scopedQuery = authContext ? await scopedReadQuery(query, authContext) : query;
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

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

async function exportSubmissionsCsv(query = {}, authContext) {
  const result = await listSubmissions({ ...query, page: 1, limit: query.limit || 5000 }, authContext);
  return csvRows([
    [
      'Submission ID', 'Production task ID', 'Order ID', 'Order item ID', 'External order ID',
      'Vendor order ID', 'SKU', 'Vendor', 'Vendor product', 'Cost center', 'Provider',
      'Status', 'Attempts', 'Submitted at', 'Failed at', 'Failure reason',
    ],
    ...result.items.map((submission) => [
      submission.id,
      submission.productionTaskId,
      submission.orderId,
      submission.orderItemId,
      submission.externalOrderId,
      submission.vendorExternalOrderId,
      submission.sku,
      submission.vendorName,
      submission.vendorProductName,
      submission.costCenterCode,
      submission.provider,
      submission.status,
      submission.submitAttemptCount,
      submission.submittedAt,
      submission.failedAt,
      submission.failureReason,
    ]),
  ]);
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

async function assertCanReadSubmission(submission, authContext) {
  const ids = await orderPublic.personalSellerItemIds?.(authContext, vendorSubmissionPermissions.READ);
  if (ids !== undefined) {
    if (!ids.map(String).includes(String(submission.orderItemId))) throw forbidden();
    return;
  }
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.READ, authContext);
}

async function scopedReadQuery(query = {}, authContext = {}) {
  const sellerOrderItemIds = await orderPublic.personalSellerItemIds?.(authContext, vendorSubmissionPermissions.READ);
  if (sellerOrderItemIds !== undefined) return { ...query, sellerOrderItemIds };
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
  const scopedQuery = await scopedReadQuery(query, authContext);
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
  await assertCanReadSubmission(submission, authContext);
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
    payloadSnapshot: await snapshotFromTask(task),
  };

  try {
    const created = await repository.create(payload);
    await recordSubmissionOperation({
      action: 'VENDOR_SUBMISSION_CREATED', submission: created, authContext,
      metadata: { productionTaskId: String(productionTaskId) },
    });
    return toVendorSubmissionDto(created, { detail: true });
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
  await assertCanReadSubmission(submission, authContext);
  return toPayloadPreviewDto(submission.payloadSnapshot || {});
}

async function markSubmitted(submissionId, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  await orderPublic.assertMarketplaceAllowsFulfillment(submission.orderId, submission.orderItemId);
  if (submission.status === vendorSubmissionStatuses.SUBMITTED) {
    await repairProductionHandoff(submission, authContext);
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
  await recordSubmissionOperation({
    action: 'VENDOR_SUBMISSION_SUBMITTED', submission: updated, authContext,
    changes: { status: { from: submission.status, to: vendorSubmissionStatuses.SUBMITTED } },
  });
  await repairProductionHandoff(updated, authContext);
  return toVendorSubmissionDto(updated, { detail: true });
}

async function createAndSubmitFromProductionTask(productionTaskId, authContext) {
  // LNG submissions require the normalized fulfillmentOrder payload. Keep the
  // legacy path for other vendors, which use their own snapshot adapters.
  const productionPort = require('../../production/public');
  const task = await productionPort.getTaskById(productionTaskId, { ...(authContext || {}), system: true });
  if (task && vendorCode(task) === 'LNG_GROUP') {
    return createAndSubmitFulfillmentOrderFromProductionTask(productionTaskId, authContext);
  }

  const submission = await createFromProductionTask(productionTaskId, authContext);
  return submitToVendor(submission.id, { dryRun: false }, authContext);
}

function isActiveOrderItem(item) {
  return !['CANCELLED', 'REFUNDED'].includes(String(item?.status || '').toUpperCase());
}

function vendorCode(task = {}) {
  return String(
    task.vendorProduct?.vendor?.code
    || task.vendorProductSnapshot?.vendor?.code
    || task.vendorProduct?.vendorCode
    || task.vendorProductSnapshot?.vendorCode
    || '',
  ).trim().toUpperCase();
}

async function buildFulfillmentOrder(order, items, tasks) {
  const taskByItemId = new Map(tasks.map((task) => [String(task.orderItemId), task]));
  const activeItems = items.filter(isActiveOrderItem);
  const snapshots = await Promise.all(activeItems.map(async (item) => {
    const task = taskByItemId.get(String(item._id || item.id));
    const snapshot = await snapshotFromTask(task);
    return {
      externalItemId: item.externalItemId,
      sku: item.sku || null,
      title: item.title || null,
      quantity: item.quantity,
      asin: item.asin || null,
      currency: item.price?.currency || null,
      unitPrice: item.price?.itemPriceAmount || null,
      productionStatus: 'QC_PASSED',
      scaleStatus: task.scaleStatus || null,
      fulfillmentFile: { assets: (snapshot.fileChecks || []).filter((file) => file.outputVendorUrl).map((file) => ({
        slotKey: file.slotKey,
        slotLabel: file.slotLabel || null,
        url: file.outputVendorUrl,
      })) },
      metadata: { lngOrderItemId: String(item._id || item.id), productionTaskId: String(task._id || task.id) },
    };
  }));
  return {
    externalOrderId: order.externalOrderId,
    orderNumber: order.externalOrderId,
    source: 'LNG_WEB',
    sourceChannel: order.salesChannelCode,
    marketplace: order.marketplaceCode,
    purchaseAt: order.orderedAt || null,
    recipient: {
      name: order.shippingAddress?.name || order.buyer?.name || null,
      phone: order.shippingAddress?.phoneMasked || null,
      email: order.buyer?.emailMasked || null,
      address: {
        line1: order.shippingAddress?.addressLine1 || null,
        line2: order.shippingAddress?.addressLine2 || null,
        city: order.shippingAddress?.city || null,
        state: order.shippingAddress?.stateOrProvinceCode || order.shippingAddress?.stateOrProvince || null,
        postalCode: order.shippingAddress?.postalCode || null,
        country: order.shippingAddress?.countryCode || order.shippingAddress?.country || null,
      },
    },
    destinationCountry: order.shippingAddress?.countryCode || order.shippingAddress?.country || null,
    destinationState: order.shippingAddress?.stateOrProvinceCode || order.shippingAddress?.stateOrProvince || null,
    destinationCity: order.shippingAddress?.city || null,
    destinationPostalCode: order.shippingAddress?.postalCode || null,
    shippingService: order.shippingService?.name || order.shippingService?.level || null,
    items: snapshots,
    metadata: { lngOrderId: String(order._id || order.id), handoffVersion: 1 },
  };
}

async function createAndSubmitFulfillmentOrderFromProductionTask(productionTaskId, authContext) {
  // Resolve at call time because production triggers vendor submission.
  const productionPort = require('../../production/public');
  const task = await productionPort.getTaskById(productionTaskId, { ...(authContext || {}), system: true });
  if (!task || vendorCode(task) !== 'LNG_GROUP') return null;

  const [order, items, tasks] = await Promise.all([
    orderPublic.findById(task.orderId),
    orderPublic.listItemsByOrder(task.orderId),
    productionPort.getTasksByOrderId(task.orderId, { ...(authContext || {}), system: true }),
  ]);
  const activeItems = items.filter(isActiveOrderItem);
  const taskByItemId = new Map(tasks.map((entry) => [String(entry.orderItemId), entry]));
  const ready = activeItems.length > 0 && activeItems.every((item) => {
    const itemTask = taskByItemId.get(String(item._id || item.id));
    return itemTask?.qcStatus === 'PASSED' && itemTask?.status === 'READY_TO_SEND_VENDOR' && vendorCode(itemTask) === 'LNG_GROUP';
  });
  if (!ready) return { deferred: true };

  const submission = await createFromProductionTask(productionTaskId, authContext);
  const payloadSnapshot = {
    ...(submission.payloadSnapshot || {}),
    fulfillmentOrder: await buildFulfillmentOrder(order, items, tasks),
  };
  await repository.updateById(submission.id, { payloadSnapshot });
  return submitToVendor(submission.id, { provider: 'LNG_GROUP', dryRun: false }, authContext);
}

async function repairProductionHandoff(submission, authContext) {
  try {
    await productionPublic.markSentToVendor(
      String(submission.productionTaskId), String(submission._id || submission.id),
      productionHandoffContext(authContext),
    );
  } catch (error) {
    const sameSubmittedTask = error?.statusCode === httpStatus.CONFLICT
      && error?.details?.status === 'SENT_TO_VENDOR'
      && String(error?.details?.vendorSubmissionId || '') === String(submission._id || submission.id);
    if (!sameSubmittedTask) throw error;
  }
  const shipmentPublic = require('../../shipment/public');
  await shipmentPublic.ensureFromVendorSubmission(String(submission._id || submission.id), authContext);
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
  await recordSubmissionOperation({
    action: 'VENDOR_SUBMISSION_FAILED', submission: updated, authContext,
    changes: {
      status: { from: submission.status, to: vendorSubmissionStatuses.FAILED },
      reasonProvided: auditReasonProvided(reason),
    },
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

  const reason = payload.cancelReason ? String(payload.cancelReason).trim() : null;
  const updated = await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.CANCELLED,
    cancelledBy: authContext?.accountId || null,
    cancelledAt: new Date(),
    cancelReason: reason,
    statusHistory: appendStatusHistory(
      submission,
      vendorSubmissionStatuses.CANCELLED,
      authContext,
      reason,
    ),
  });
  await recordSubmissionOperation({
    action: 'VENDOR_SUBMISSION_CANCELLED', submission: updated, authContext,
    changes: {
      status: { from: submission.status, to: vendorSubmissionStatuses.CANCELLED },
      reasonProvided: auditReasonProvided(reason),
    },
  });
  return toVendorSubmissionDto(updated, { detail: true });
}

async function retry(submissionId, payload = {}, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  await orderPublic.assertMarketplaceAllowsFulfillment(submission.orderId, submission.orderItemId);
  if (submission.status !== vendorSubmissionStatuses.FAILED) {
    throw conflict('Only failed vendor submissions can be retried', { status: submission.status });
  }
  const reason = payload.reason ? String(payload.reason).trim() : null;
  const updated = await repository.updateById(submissionId, {
    status: vendorSubmissionStatuses.READY,
    failedAt: submission.failedAt || null,
    failureReason: submission.failureReason || null,
    statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.READY, authContext, reason),
  });
  await recordSubmissionOperation({
    action: 'VENDOR_SUBMISSION_RETRIED', submission: updated, authContext,
    changes: {
      status: { from: submission.status, to: vendorSubmissionStatuses.READY },
      reasonProvided: auditReasonProvided(reason),
    },
  });
  return toVendorSubmissionDto(updated, { detail: true });
}

async function submitToVendor(submissionId, payload = {}, authContext) {
  const dryRun = payload.dryRun !== false;
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  await orderPublic.assertMarketplaceAllowsFulfillment(submission.orderId, submission.orderItemId);

  if (submission.status === vendorSubmissionStatuses.SUBMITTED) {
    await repairProductionHandoff(submission, authContext);
    return toVendorSubmissionDto(submission, { detail: true });
  }

  const vendor = submission.payloadSnapshot?.vendorProduct?.vendor || {};
  const vendorId = String(vendor.id || vendor._id || '').trim();
  const integration = vendorId
    ? await vendorPublic.getVendorIntegrationAssignment(vendorId)
    : null;
  const provider = String(integration?.adapterKey || integration?.providerKey || '').trim().toUpperCase();
  const requestedProvider = String(payload.provider || '').trim().toUpperCase();
  if (!vendorId || !integration) throw validationError('Vendor integration is not configured');
  if (provider === 'CUSTOM') throw validationError('Generic API vendor submission is not supported');
  if (!provider) throw validationError('Native vendor integration is not configured');
  if (!dryRun && integration.status !== 'CONNECTED') {
    throw validationError('Native vendor integration is not connected', { provider });
  }
  if (requestedProvider && requestedProvider !== provider) {
    throw validationError('Provider does not match mapped vendor');
  }
  const adapter = submitRegistry.getAdapter(provider);

  if (submission.status !== vendorSubmissionStatuses.READY) {
    throw conflict('Vendor submission is not ready to submit', { status: submission.status });
  }

  const operationKey = `vendor-submission:${submissionId}`;

  if (dryRun) {
    const submitPayload = adapter.buildPayload(submission, { idempotencyKey: operationKey });
    adapter.validatePayload(submitPayload);
    return {
      provider: adapter.provider,
      dryRun: true,
      payload: stripUnsafe(submitPayload),
      validation: { ok: true },
    };
  }

  const claimed = await repository.claimReadyForSubmit(submissionId, {
    provider, operationKey, claimedAt: new Date(),
  });
  if (!claimed) throw conflict('Vendor submission is already being processed');

  let submitResult;
  try {
    const submitPayload = adapter.buildPayload(claimed, { idempotencyKey: operationKey });
    adapter.validatePayload(submitPayload);
    const credential = await vendorPublic.getVendorIntegrationCredential(vendorId, provider);
    if (!credential) throw validationError('Vendor credentials are not configured');
    await orderPublic.assertMarketplaceAllowsFulfillment(claimed.orderId, claimed.orderItemId);
    submitResult = await adapter.submitPayload(submitPayload, { credential, idempotencyKey: operationKey });
  } catch (error) {
    if (error?.details?.response || error?.statusCode === 400) {
      const failed = await repository.transitionStatus(submissionId, [vendorSubmissionStatuses.SUBMITTING], {
        status: vendorSubmissionStatuses.FAILED,
        provider: adapter.provider,
        submittedResponse: stripUnsafe(error?.details?.response || null),
        failedBy: authContext?.accountId || null,
        failedAt: new Date(),
        failureReason: error.message || 'Vendor submit failed',
        statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.FAILED, authContext, error.message || 'Vendor submit failed'),
      });
      if (failed) {
        await recordSubmissionOperation({
          action: 'VENDOR_SUBMISSION_FAILED', submission: failed, authContext,
          changes: {
            status: { from: vendorSubmissionStatuses.SUBMITTING, to: vendorSubmissionStatuses.FAILED },
            reasonCode: error?.details?.response ? 'VENDOR_SUBMIT_REJECTED' : 'VENDOR_SUBMIT_INVALID',
          },
          metadata: { provider: adapter.provider },
        });
      }
    } else {
      const needsReview = await repository.transitionStatus(submissionId, [vendorSubmissionStatuses.SUBMITTING], {
        status: vendorSubmissionStatuses.NEEDS_REVIEW,
        failedBy: authContext?.accountId || null,
        failedAt: new Date(),
        failureReason: error.message || 'Vendor submit outcome is unknown',
        statusHistory: appendStatusHistory(claimed, vendorSubmissionStatuses.NEEDS_REVIEW, authContext, 'Ambiguous vendor response'),
      });
      if (needsReview) {
        await recordSubmissionOperation({
          action: 'VENDOR_SUBMISSION_NEEDS_REVIEW', submission: needsReview, authContext,
          changes: { status: { from: vendorSubmissionStatuses.SUBMITTING, to: vendorSubmissionStatuses.NEEDS_REVIEW } },
          metadata: { provider: adapter.provider },
        });
      }
    }
    throw error;
  }
  const updated = await repository.transitionStatus(submissionId, [vendorSubmissionStatuses.SUBMITTING], {
    status: vendorSubmissionStatuses.SUBMITTED,
    provider: adapter.provider,
    vendorExternalOrderId: submitResult.externalId || null,
    submittedResponse: stripUnsafe(submitResult.response || null),
    submittedBy: authContext?.accountId || null,
    submittedAt: new Date(),
    statusHistory: appendStatusHistory(submission, vendorSubmissionStatuses.SUBMITTED, authContext, `Submitted to ${adapter.provider}`),
  });
  if (!updated) throw conflict('Vendor submission state changed during submit');
  await recordSubmissionOperation({
    action: 'VENDOR_SUBMISSION_SUBMITTED', submission: updated, authContext,
    changes: { status: { from: submission.status, to: vendorSubmissionStatuses.SUBMITTED } },
    metadata: { provider: adapter.provider },
  });

  await repairProductionHandoff(updated, authContext);

  return toVendorSubmissionDto(updated, { detail: true });
}

async function reconcile(submissionId, payload = {}, authContext) {
  const submission = await loadSubmission(submissionId);
  assertCanAccessShop(submission.shopId, vendorSubmissionPermissions.WRITE, authContext);
  if (submission.status !== vendorSubmissionStatuses.NEEDS_REVIEW) {
    throw conflict('Only submissions needing review can be reconciled', { status: submission.status });
  }

  const remoteFound = payload.outcome === 'REMOTE_FOUND';
  const nextStatus = remoteFound ? vendorSubmissionStatuses.SUBMITTED : vendorSubmissionStatuses.READY;
  const updated = await repository.transitionStatus(submissionId, [vendorSubmissionStatuses.NEEDS_REVIEW], {
    status: nextStatus,
    ...(remoteFound ? {
      vendorExternalOrderId: payload.vendorExternalOrderId,
      submittedBy: authContext?.accountId || null,
      submittedAt: new Date(),
    } : { submitClaimedAt: null }),
    statusHistory: appendStatusHistory(submission, nextStatus, authContext, payload.reason || `Reconciled as ${payload.outcome}`),
  });
  if (!updated) throw conflict('Vendor submission state changed during reconciliation');
  await recordSubmissionOperation({
    action: 'VENDOR_SUBMISSION_RECONCILED', submission: updated, authContext,
    changes: { status: { from: submission.status, to: nextStatus } },
    metadata: { outcome: payload.outcome },
  });
  if (remoteFound) await repairProductionHandoff(updated, authContext);
  return toVendorSubmissionDto(updated, { detail: true });
}

async function listLatestByProductionTaskIds(productionTaskIds = [], authContext) {
  const ids = [...new Set((productionTaskIds || []).map(String).filter(Boolean))];
  ids.forEach((id) => assertValidObjectId(id, 'productionTaskId'));
  const submissions = await repository.listLatestByProductionTaskIds(ids);
  if (authContext) {
    await Promise.all(submissions.map(submission => assertCanReadSubmission(submission, authContext)));
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
  createAndSubmitFromProductionTask,
  createAndSubmitFulfillmentOrderFromProductionTask,
  createFromProductionTask,
  exportSubmissionsCsv,
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
  reconcile,
  retry,
  submitToVendor,
  summarizePerformance,
  summarizePerformancePage,
  summarizeSubmissions,
};
