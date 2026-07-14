const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { normalizePagination } = require('../../../shared/utils/pagination');
const logger = require('../../../shared/utils/logger');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const customizationPublic = require('../../customization/public');
const mappingPublic = require('../../mapping/public');
const mediaPublic = require('../../media/public');
const orderPublic = require('../../order/public');
const {
  productionBlockers,
  productionPermissions,
  productionQcStatuses,
  productionScaleStatuses,
  productionSourceTypes,
  productionTaskStatuses,
} = require('../constants/production.constants');
const repository = require('../repositories/productionTask.repository');
const {
  toId,
  toProductionTaskDto,
  toProductionTaskSummaryDto,
} = require('../dtos/productionTask.dto');

const SHOP_SCOPE_TYPE = 'shop';
const DESIGN_ASSIGNABLE_STATUSES = [
  productionTaskStatuses.BLOCKED,
  productionTaskStatuses.NEED_SCALE,
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

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasPermission(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission) || (
    permission === productionPermissions.READ
    && permissions.includes(productionPermissions.WRITE)
  );
}

function isSystemContext(authContext = {}) {
  return authContext && authContext.system === true;
}

function getScopedShopIds(authContext = {}, permission) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(permission)
    ))
    .map((scope) => String(scope.scopeId)))];
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (isSystemContext(authContext) || hasPermission(authContext, permission)) return;
  if (!authContext) throw forbidden();
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function emptyTaskList(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 50, maxLimit: 100 });
  return { items: [], total: 0, page, limit };
}

function emptyTaskSummary() {
  return {
    total: 0,
    unassigned: 0,
    assigned: 0,
    blocked: 0,
    needScale: 0,
    qcPending: 0,
    readyToSendVendor: 0,
    byScaleStatus: {},
    byQcStatus: {},
    byAssignmentStatus: {},
    bySalesChannelCode: {},
    blockers: {},
  };
}

function applyReadScope(query, authContext) {
  if (isSystemContext(authContext) || hasPermission(authContext, productionPermissions.READ)) {
    return query;
  }

  const scopedShopIds = getScopedShopIds(authContext, productionPermissions.READ);
  if (scopedShopIds.length === 0) return null;
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return null;
  if (query.shopId) return query;
  return { ...query, shopIds: scopedShopIds };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseEmployeeCodeFromSku(sku) {
  const [employeeCode] = String(sku || '').trim().split('-');
  return employeeCode || null;
}

function collectProductionUserIds(tasks = []) {
  return unique(tasks.flatMap((task) => [
    toId(task?.assignedDesignUserId),
    toId(task?.qcBy),
    toId(task?.orderSnapshot?.assignedStaffId),
  ]));
}

async function attachProductionUsers(tasks = []) {
  const userIds = collectProductionUserIds(tasks);
  const sellerCodes = unique(tasks.map((task) => parseEmployeeCodeFromSku(task?.orderItemSnapshot?.sku)));
  if (userIds.length === 0 && sellerCodes.length === 0) return tasks;
  const [profiles, sellerProfiles] = await Promise.all([
    userIds.length ? authPublic.listProfilesByAccountIds(userIds) : [],
    sellerCodes.length && typeof authPublic.listProfilesByEmployeeCodes === 'function'
      ? authPublic.listProfilesByEmployeeCodes(sellerCodes)
      : [],
  ]);
  const profileByAccountId = new Map((profiles || [])
    .filter((profile) => profile?.accountId)
    .map((profile) => [String(profile.accountId), profile]));
  const sellerByEmployeeCode = new Map((sellerProfiles || [])
    .filter((profile) => profile?.employeeCode)
    .map((profile) => [String(profile.employeeCode).toUpperCase(), profile]));
  return tasks.map((task) => (task ? {
    ...task,
    scaleByUser: profileByAccountId.get(toId(task.assignedDesignUserId)) || null,
    qcByUser: profileByAccountId.get(toId(task.qcBy)) || null,
    orderOwnerUser: profileByAccountId.get(toId(task.orderSnapshot?.assignedStaffId)) || null,
    sellerUser: sellerByEmployeeCode.get(String(parseEmployeeCodeFromSku(task.orderItemSnapshot?.sku)).toUpperCase()) || null,
  } : task));
}

function assertDesignAssignable(task) {
  if (!DESIGN_ASSIGNABLE_STATUSES.includes(task.status)) {
    throw conflict('Production task is not assignable to design', { status: task.status });
  }
}

function customerImageAssetIds(customization) {
  return (customization?.imageAssets || []).map((image) => image.assetId).filter(Boolean);
}

function firstDesignAsset(template, type) {
  return (template?.designAssets || []).find((asset) => asset.type === type && asset.status !== 'INACTIVE') || null;
}

function firstCustomerImageId(imageAssetIds, index) {
  return imageAssetIds[index] || imageAssetIds[0] || null;
}

function baseFileCheck({ slotKey, slotLabel, required, sourceType, inputAssetId, blockers }) {
  const missingInput = required && !inputAssetId;
  const nextBlockers = unique([
    ...(blockers || []),
    ...(missingInput ? [sourceType === productionSourceTypes.PSD_TEMPLATE
      ? productionBlockers.PSD_MISSING
      : productionBlockers.CUSTOMER_IMAGE_MISSING] : []),
    ...(inputAssetId ? [productionBlockers.SCALED_OUTPUT_MISSING] : []),
  ]);

  return {
    slotKey,
    slotLabel,
    required,
    sourceType,
    inputAssetId,
    outputAssetId: null,
    scaleStatus: inputAssetId ? productionScaleStatuses.NEED_SCALE : productionScaleStatuses.NOT_REQUIRED,
    qcStatus: productionQcStatuses.NOT_READY,
    blockers: nextBlockers,
    note: null,
  };
}

function buildFileChecks({ listing, template, customization }) {
  const imageAssetIds = customerImageAssetIds(customization);
  const psdAssetId = listing?.psdTemplateAssetId
    || firstDesignAsset(template, 'PSD_TEMPLATE')?.mediaAssetId
    || null;
  const checks = [
    baseFileCheck({
      slotKey: 'PSD_TEMPLATE',
      slotLabel: 'PSD template',
      required: true,
      sourceType: productionSourceTypes.PSD_TEMPLATE,
      inputAssetId: psdAssetId,
    }),
  ];

  (template?.artworkSlots || []).forEach((slot, index) => {
    checks.push(baseFileCheck({
      slotKey: slot.key,
      slotLabel: slot.label || slot.key,
      required: Boolean(slot.required),
      sourceType: productionSourceTypes.CUSTOMER_IMAGE,
      inputAssetId: firstCustomerImageId(imageAssetIds, index),
    }));
  });

  return checks;
}

function hardBlockers(fileChecks = [], extra = []) {
  return unique([
    ...extra,
    ...fileChecks.flatMap((check) => check.blockers || []),
  ]).filter((blocker) => blocker !== productionBlockers.SCALED_OUTPUT_MISSING);
}

function aggregateStatus(fileChecks = [], extraBlockers = []) {
  const hard = hardBlockers(fileChecks, extraBlockers);
  if (hard.length > 0) {
    return {
      status: productionTaskStatuses.BLOCKED,
      scaleStatus: productionScaleStatuses.NEED_SCALE,
      qcStatus: productionQcStatuses.NOT_READY,
      blockers: unique([...hard, ...fileChecks.flatMap((check) => check.blockers || [])]),
    };
  }

  const requiredChecks = fileChecks.filter((check) => check.required);
  const allScaled = requiredChecks.every((check) => check.outputAssetId);
  if (!allScaled) {
    return {
      status: productionTaskStatuses.NEED_SCALE,
      scaleStatus: productionScaleStatuses.NEED_SCALE,
      qcStatus: productionQcStatuses.NOT_READY,
      blockers: [productionBlockers.SCALED_OUTPUT_MISSING],
    };
  }

  const allQcPassed = requiredChecks.every((check) => check.qcStatus === productionQcStatuses.PASSED);
  if (allQcPassed) {
    return {
      status: productionTaskStatuses.READY_TO_SEND_VENDOR,
      scaleStatus: productionScaleStatuses.SCALED,
      qcStatus: productionQcStatuses.PASSED,
      blockers: [],
    };
  }

  return {
    status: productionTaskStatuses.QC_PENDING,
    scaleStatus: productionScaleStatuses.SCALED,
    qcStatus: productionQcStatuses.PENDING,
    blockers: [],
  };
}

function orderItemStatusForProductionAggregate(aggregate, mode = 'task') {
  if (aggregate.status === productionTaskStatuses.READY_TO_SEND_VENDOR) {
    return 'READY_TO_SEND_VENDOR';
  }
  if (mode === 'upload' && aggregate.status === productionTaskStatuses.QC_PENDING) {
    return 'IN_PRODUCTION';
  }
  return 'NEED_PRODUCTION';
}

async function transitionOrderItemStatus(orderItemId, targetStatus) {
  return orderPublic.transitionItemStatus(orderItemId, targetStatus, { source: 'PRODUCTION' });
}

function toCustomizationSnapshot(customization) {
  if (!customization) return null;
  return {
    payloadId: customization.payloadId || null,
    status: customization.status || null,
    needsReview: Boolean(customization.needsReview),
    customerInputs: customization.customerInputs || null,
    imageAssets: customization.imageAssets || [],
    failedImages: customization.failedImages || [],
  };
}

function toOrderSnapshot(order) {
  if (!order) return null;
  return {
    id: toId(order._id || order.id),
    status: order.status || null,
    assignedStaffId: toId(order.assignedStaffId),
    externalAccountId: order.externalAccountId || null,
  };
}

function snapshotPayload({ item, order, plan, listing, template, customization, fileChecks, aggregate }) {
  return {
    orderId: item.orderId,
    shopId: item.shopId,
    orderItemId: item._id || item.id,
    fulfillmentPlanId: plan.id,
    orderSnapshot: toOrderSnapshot(order),
    orderItemSnapshot: {
      externalOrderId: item.externalOrderId || null,
      externalItemId: item.externalItemId || null,
      externalAccountId: item.externalAccountId || null,
      salesChannelCode: item.salesChannelCode || null,
      marketplaceCode: item.marketplaceCode || null,
      asin: item.asin || null,
      sku: item.sku || null,
      title: item.title || null,
      status: item.status || null,
      groupId: item.groupId || null,
      groupType: item.groupType || null,
    },
    listingSnapshot: listing || plan.listing || null,
    templateSnapshot: template || plan.internalTemplate || null,
    customizationSnapshot: toCustomizationSnapshot(customization),
    vendorProductSnapshot: plan.vendorProduct || null,
    vendorCostCenterSnapshot: plan.vendorCostCenter || null,
    fulfillQty: item.quantity || 1,
    fileChecks,
    ...aggregate,
  };
}

async function attachCustomizationSnapshots(tasks = [], authContext) {
  const missing = tasks.filter((task) => task && !task.customizationSnapshot && task.orderItemId);
  if (missing.length === 0) return tasks;
  const views = await customizationPublic.listOrderItemCustomizationViews(
    missing.map((task) => toId(task.orderItemId)),
    authContext,
  );
  const byOrderItemId = new Map((views || []).map((view) => [toId(view.orderItemId), toCustomizationSnapshot(view)]));
  return tasks.map((task) => (
    task && !task.customizationSnapshot
      ? { ...task, customizationSnapshot: byOrderItemId.get(toId(task.orderItemId)) || null }
      : task
  ));
}

async function attachCustomizationSnapshot(task, authContext) {
  const [enriched] = await attachCustomizationSnapshots(task ? [task] : [], authContext);
  return enriched || null;
}

async function loadReadyPlan(orderItemId, authContext) {
  const plan = await mappingPublic.getFulfillmentPlanForOrderItem(orderItemId, authContext);
  if (!plan || plan.status !== 'READY') {
    throw conflict('Fulfillment plan is not ready for production', {
      blockingReasons: [productionBlockers.MAPPING_NOT_READY],
    });
  }
  return plan;
}

async function loadTask(taskId) {
  assertValidObjectId(taskId, 'taskId');
  const task = await repository.findById(taskId);
  if (!task) throw notFound('Production task not found');
  return task;
}

async function appendProductionTimeline({ item, eventType, authContext }) {
  await orderPublic.appendTimeline({
    orderId: item.orderId,
    orderItemId: item._id || item.id,
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    eventType,
    source: 'PRODUCTION',
    actorId: authContext?.accountId || null,
  });
}

async function appendTaskTimeline(task, eventType, authContext) {
  const item = await orderPublic.findItemById(task.orderItemId);
  if (!item) throw notFound('Order item not found');
  await appendProductionTimeline({ item, eventType, authContext });
}

async function triggerVendorSubmissionForReadyTask(taskId, authContext) {
  try {
    // ponytail: inline V1 trigger; move to a queue when retries/throughput matter.
    const vendorSubmissionPublic = require('../../vendorSubmission/public');
    if (typeof vendorSubmissionPublic.createFromProductionTask === 'function') {
      await vendorSubmissionPublic.createFromProductionTask(taskId, {
        ...(authContext || {}),
        system: true,
        source: 'PRODUCTION',
      });
    }
  } catch (error) {
    logger.warn('Auto vendor submission trigger skipped', {
      productionTaskId: taskId,
      error,
    });
  }
}

async function triggerPsdTaskForMissingListing({ task, listingId, authContext }) {
  if (!(task?.blockers || []).includes(productionBlockers.PSD_MISSING) || !listingId) return;

  try {
    // ponytail: inline V1 trigger; move to a queue when retries/throughput matter.
    const designPublic = require('../../design/public');
    if (typeof designPublic.createPsdTemplateTaskFromListing === 'function') {
      await designPublic.createPsdTemplateTaskFromListing(toId(listingId), {
        note: 'Auto-created from production PSD_MISSING blocker',
      }, {
        ...(authContext || {}),
        system: true,
        source: 'PRODUCTION',
      });
    }
  } catch (error) {
    logger.warn('Auto PSD design task trigger skipped', {
      productionTaskId: toId(task),
      listingId: toId(listingId),
      error,
    });
  }
}

async function createOrRecheckTaskForOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  assertCanAccessShop(item.shopId, productionPermissions.WRITE, authContext);
  const order = item.orderId ? await orderPublic.findById(item.orderId) : null;

  const plan = await loadReadyPlan(orderItemId, authContext);
  const listing = plan.listing?.id ? await catalogPublic.getListingById(plan.listing.id) : null;
  const templateId = plan.internalTemplate?.id || listing?.internalTemplateId;
  const template = templateId ? await catalogPublic.getInternalTemplateById(templateId) : null;
  const customization = await customizationPublic.getOrderItemCustomizationView(orderItemId, authContext);
  const extraBlockers = template ? [] : [productionBlockers.TEMPLATE_NOT_FOUND];
  const fileChecks = buildFileChecks({ listing, template, customization });
  const aggregate = aggregateStatus(fileChecks, extraBlockers);
  const existing = await repository.findByOrderItem(orderItemId);
  const task = await repository.upsertByOrderItem(orderItemId, {
    ...snapshotPayload({ item, order, plan, listing, template, customization, fileChecks, aggregate }),
    assignedDesignUserId: existing?.assignedDesignUserId || null,
    assignedAt: existing?.assignedAt || null,
    designNote: existing?.designNote || null,
    qcBy: existing?.qcBy || null,
    qcAt: existing?.qcAt || null,
    readyAt: aggregate.status === productionTaskStatuses.READY_TO_SEND_VENDOR ? new Date() : null,
    sentToVendorAt: existing?.sentToVendorAt || null,
    vendorSubmissionId: existing?.vendorSubmissionId || null,
  });

  await transitionOrderItemStatus(orderItemId, orderItemStatusForProductionAggregate(aggregate));
  if (!existing) {
    await appendProductionTimeline({ item, eventType: 'PRODUCTION_TASK_CREATED', authContext });
  }
  await triggerPsdTaskForMissingListing({
    task,
    listingId: listing?.id || listing?._id || plan.listing?.id,
    authContext,
  });

  const [enrichedTask] = await attachProductionUsers([task]);
  return toProductionTaskDto(enrichedTask);
}

async function getTaskByOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  assertCanAccessShop(item.shopId, productionPermissions.READ, authContext);
  const [task] = await attachProductionUsers([
    ...(await attachOrderSnapshots([
      await attachCustomizationSnapshot(await repository.findByOrderItem(orderItemId), authContext),
    ])),
  ]);
  return toProductionTaskDto(task);
}

async function listPsdBlockedTasksByListing(listingId) {
  assertValidObjectId(listingId, 'listingId');
  const tasks = await repository.listPsdBlockedByListingId(listingId);
  return (tasks || []).map((task) => ({
    id: toId(task),
    orderItemId: toId(task.orderItemId),
    shopId: toId(task.shopId),
    blockers: task.blockers || [],
  }));
}

function toPsdRecheckItem(task, result) {
  const blockers = result?.blockers || [];
  const isCleared = !blockers.includes(productionBlockers.PSD_MISSING);
  return {
    taskId: toId(task),
    orderItemId: toId(task.orderItemId),
    status: isCleared ? 'CLEARED' : 'STILL_BLOCKED',
    blockers,
  };
}

async function attachOrderSnapshots(tasks = []) {
  const missing = tasks.filter((task) => task && !task.orderSnapshot && task.orderId);
  if (!missing.length) return tasks;
  const orders = await Promise.all(missing.map((task) => orderPublic.findById(task.orderId)));
  const byOrderId = new Map(orders
    .filter(Boolean)
    .map((order) => [toId(order._id || order.id), toOrderSnapshot(order)]));
  return tasks.map((task) => (task && !task.orderSnapshot
    ? { ...task, orderSnapshot: byOrderId.get(toId(task.orderId)) || null }
    : task));
}

async function recheckPsdBlockedTasks(payload = {}, authContext = {}) {
  const limit = Math.min(Number(payload.limit || 50), 100);
  const query = {
    ...(payload.shopId ? { shopId: payload.shopId } : {}),
    blocker: productionBlockers.PSD_MISSING,
    page: 1,
    limit,
  };
  if (query.shopId) assertCanAccessShop(query.shopId, productionPermissions.WRITE, authContext);
  const result = await repository.list(query);
  const items = [];

  for (const task of result.items || []) {
    assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
    try {
      items.push(toPsdRecheckItem(
        task,
        await createOrRecheckTaskForOrderItem(toId(task.orderItemId), authContext),
      ));
    } catch (error) {
      items.push({
        taskId: toId(task),
        orderItemId: toId(task.orderItemId),
        status: 'FAILED',
        blockers: task.blockers || [],
        message: error.message,
      });
    }
  }

  return {
    checked: items.length,
    cleared: items.filter((item) => item.status === 'CLEARED').length,
    stillBlocked: items.filter((item) => item.status === 'STILL_BLOCKED').length,
    items,
  };
}

async function getTaskById(taskId, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.READ, authContext);
  const [enrichedTask] = await attachProductionUsers([
    ...(await attachOrderSnapshots([
      await attachCustomizationSnapshot(task, authContext),
    ])),
  ]);
  return toProductionTaskDto(enrichedTask);
}

function normalizeListQuery(query = {}) {
  const result = {};
  if (query.status) result.status = String(query.status).trim().toUpperCase();
  if (query.scaleStatus) result.scaleStatus = String(query.scaleStatus).trim().toUpperCase();
  if (query.qcStatus) result.qcStatus = String(query.qcStatus).trim().toUpperCase();
  if (query.salesChannelCode) result.salesChannelCode = String(query.salesChannelCode).trim().toUpperCase();
  if (query.blocker) result.blocker = String(query.blocker).trim().toUpperCase();
  if (query.designAssignmentStatus) {
    result.designAssignmentStatus = String(query.designAssignmentStatus).trim().toUpperCase();
  }
  if (query.search) result.search = String(query.search).trim();
  if (query.sort) result.sort = String(query.sort).trim();
  ['dateFrom', 'dateTo', 'assignedAtFrom', 'assignedAtTo', 'readyAtFrom', 'readyAtTo'].forEach((field) => {
    if (query[field]) result[field] = query[field] instanceof Date ? query[field] : new Date(query[field]);
  });
  if (query.page) result.page = Number(query.page);
  if (query.limit) result.limit = Number(query.limit);
  if (query.shopId) {
    assertValidObjectId(query.shopId, 'shopId');
    result.shopId = query.shopId;
  }
  if (query.unassigned === true || query.unassigned === 'true') {
    result.assignedDesignUserId = null;
  } else if (query.scaleBy || query.assignedDesignUserId) {
    const assignedDesignUserId = query.scaleBy || query.assignedDesignUserId;
    assertValidObjectId(assignedDesignUserId, 'scaleBy');
    result.assignedDesignUserId = assignedDesignUserId;
  }
  if (query.qcBy) {
    assertValidObjectId(query.qcBy, 'qcBy');
    result.qcBy = query.qcBy;
  }
  return result;
}

async function listTasks(query = {}, authContext) {
  const startedAt = Date.now();
  const normalizedQuery = normalizeListQuery(query);
  const scopedQuery = applyReadScope(normalizedQuery, authContext);
  if (!scopedQuery) return emptyTaskList(normalizedQuery);
  const result = await repository.list(scopedQuery);
  const items = await attachProductionUsers(await attachOrderSnapshots(
    await attachCustomizationSnapshots(result.items, authContext),
  ));
  const response = {
    items: items.map(toProductionTaskSummaryDto),
    total: result.total,
    page: result.page,
    limit: result.limit,
  };
  warnIfProductionQueueSlow(startedAt, {
    route: 'GET /api/production/tasks',
    resultCount: response.items.length,
    filters: scopedQuery,
  });
  return response;
}

async function summarizeTasks(query = {}, authContext) {
  const startedAt = Date.now();
  const normalizedQuery = normalizeListQuery(query);
  const scopedQuery = applyReadScope(normalizedQuery, authContext);
  if (!scopedQuery) return emptyTaskSummary();
  const summary = await repository.summarize(scopedQuery);
  warnIfProductionQueueSlow(startedAt, {
    route: 'GET /api/production/tasks/summary',
    resultCount: summary.total,
    filters: scopedQuery,
  });
  return summary;
}

function warnIfProductionQueueSlow(startedAt, { route, resultCount, filters }) {
  const durationMs = Date.now() - startedAt;
  const thresholdMs = Number(process.env.PRODUCTION_QUEUE_SLOW_MS || 500);

  if (durationMs >= thresholdMs) {
    logger.warn('slow_production_queue_request', {
      module: 'production',
      route,
      durationMs,
      resultCount,
      filters,
    });
  }
}

function findCheck(task, fileCheckId) {
  const fileCheck = (task.fileChecks || []).find((check) => toId(check) === fileCheckId);
  if (!fileCheck) throw notFound('Production file check not found');
  return fileCheck;
}

async function uploadScaledFile(taskId, fileCheckId, mediaAssetId, authContext) {
  assertValidObjectId(mediaAssetId, 'mediaAssetId');
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  await mediaPublic.assertMediaAssetExists(mediaAssetId);

  const fileChecks = (task.fileChecks || []).map((check) => {
    if (toId(check) !== fileCheckId) return check;
    return {
      ...check,
      outputAssetId: mediaAssetId,
      scaleStatus: productionScaleStatuses.SCALED,
      qcStatus: productionQcStatuses.PENDING,
      blockers: (check.blockers || []).filter((blocker) => blocker !== productionBlockers.SCALED_OUTPUT_MISSING),
    };
  });
  findCheck({ fileChecks }, fileCheckId);
  const aggregate = aggregateStatus(fileChecks);
  const updated = await repository.updateById(taskId, {
    fileChecks,
    ...aggregate,
  });

  await transitionOrderItemStatus(
    task.orderItemId,
    orderItemStatusForProductionAggregate(aggregate, 'upload'),
  );
  await appendTaskTimeline(task, 'PRODUCTION_SCALED_FILE_UPLOADED', authContext);
  return toProductionTaskDto(updated);
}

async function assertScaleDesignerAssignee(accountId) {
  const profiles = await authPublic.listAssignableProfiles({
    accountIds: [accountId],
    limit: 1,
    requiredPermission: productionPermissions.WRITE,
  });

  if (!profiles.length) {
    throw new AppError(
      'Assigned user is not eligible for scale design tasks',
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
    );
  }
}

async function assignDesignTask(taskId, payload = {}, authContext) {
  assertValidObjectId(payload.assignedDesignUserId, 'assignedDesignUserId');
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  assertDesignAssignable(task);
  await assertScaleDesignerAssignee(payload.assignedDesignUserId);
  const patch = {
    assignedDesignUserId: payload.assignedDesignUserId,
    assignedAt: new Date(),
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'designNote')) {
    patch.designNote = payload.designNote || null;
  }
  const updated = await repository.updateById(taskId, patch);
  await appendTaskTimeline(task, 'PRODUCTION_DESIGN_ASSIGNED', authContext);
  return toProductionTaskDto(updated);
}

function toBulkAssignFailure(taskId, error) {
  return {
    taskId,
    code: error.code || errorCodes.APP_ERROR,
    message: error.message,
  };
}

async function bulkAssignDesignTasks(payload = {}, authContext) {
  assertValidObjectId(payload.assignedDesignUserId, 'assignedDesignUserId');
  const assigned = [];
  const failed = [];

  for (const taskId of payload.taskIds || []) {
    try {
      assigned.push(await assignDesignTask(taskId, {
        assignedDesignUserId: payload.assignedDesignUserId,
        ...(Object.prototype.hasOwnProperty.call(payload, 'designNote')
          ? { designNote: payload.designNote }
          : {}),
      }, authContext));
    } catch (error) {
      failed.push(toBulkAssignFailure(taskId, error));
    }
  }

  return { assigned, failed };
}

async function claimDesignTask(taskId, authContext = {}) {
  assertValidObjectId(authContext.accountId, 'accountId');
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  assertDesignAssignable(task);
  if (task.assignedDesignUserId) {
    throw conflict('Production task is already assigned', {
      assignedDesignUserId: toId(task.assignedDesignUserId),
    });
  }
  const updated = await repository.updateById(taskId, {
    assignedDesignUserId: authContext.accountId,
    assignedAt: new Date(),
  });
  await appendTaskTimeline(task, 'PRODUCTION_DESIGN_CLAIMED', authContext);
  return toProductionTaskDto(updated);
}

async function updateDesignNote(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  const updated = await repository.updateById(taskId, {
    designNote: payload.designNote || null,
  });
  await appendTaskTimeline(task, 'PRODUCTION_DESIGN_NOTE_UPDATED', authContext);
  return toProductionTaskDto(updated);
}

async function submitQc(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  const decision = String(payload.decision || '').trim().toUpperCase();
  const item = await orderPublic.findItemById(task.orderItemId);
  if (!item) throw notFound('Order item not found');

  if (decision === 'REJECTED') {
    const now = new Date();
    const fileChecks = (task.fileChecks || []).map((check) => ({
      ...check,
      qcStatus: productionQcStatuses.REJECTED,
      note: payload.note || check.note || null,
      blockers: unique([...(check.blockers || []), productionBlockers.QC_REJECTED]),
    }));
    const updated = await repository.updateById(taskId, {
      fileChecks,
      status: productionTaskStatuses.QC_REJECTED,
      qcStatus: productionQcStatuses.REJECTED,
      blockers: [productionBlockers.QC_REJECTED],
      qcBy: authContext?.accountId || null,
      qcAt: now,
      readyAt: null,
    });
    await transitionOrderItemStatus(task.orderItemId, 'QC_REJECTED');
    await appendProductionTimeline({ item, eventType: 'PRODUCTION_QC_REJECTED', authContext });
    return toProductionTaskDto(updated);
  }

  if (decision !== 'PASSED') {
    throw conflict('QC decision must be PASSED or REJECTED', { field: 'decision' });
  }

  const requiredChecks = (task.fileChecks || []).filter((check) => check.required);
  if (requiredChecks.some((check) => !check.outputAssetId)) {
    throw conflict('Scaled output is required before QC pass', {
      blockingReasons: [productionBlockers.SCALED_OUTPUT_MISSING],
    });
  }

  const now = new Date();
  const fileChecks = (task.fileChecks || []).map((check) => ({
    ...check,
    qcStatus: check.required ? productionQcStatuses.PASSED : check.qcStatus,
    blockers: (check.blockers || []).filter((blocker) => blocker !== productionBlockers.QC_REJECTED),
  }));
  const updated = await repository.updateById(taskId, {
    fileChecks,
    status: productionTaskStatuses.READY_TO_SEND_VENDOR,
    scaleStatus: productionScaleStatuses.SCALED,
    qcStatus: productionQcStatuses.PASSED,
    blockers: [],
    qcBy: authContext?.accountId || null,
    qcAt: now,
    readyAt: now,
  });

  await transitionOrderItemStatus(task.orderItemId, 'READY_TO_SEND_VENDOR');
  await appendProductionTimeline({ item, eventType: 'PRODUCTION_QC_PASSED', authContext });
  await triggerVendorSubmissionForReadyTask(taskId, authContext);
  return toProductionTaskDto(updated);
}

async function markSentToVendor(taskId, vendorSubmissionId, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  if (task.status !== productionTaskStatuses.READY_TO_SEND_VENDOR) {
    throw conflict('Production task is not ready to send vendor', {
      status: task.status,
    });
  }
  const item = await orderPublic.findItemById(task.orderItemId);
  if (!item) throw notFound('Order item not found');
  const now = new Date();
  const updated = await repository.updateById(taskId, {
    status: productionTaskStatuses.SENT_TO_VENDOR,
    sentToVendorAt: now,
    vendorSubmissionId: vendorSubmissionId || null,
  });
  await transitionOrderItemStatus(task.orderItemId, 'SENT_TO_VENDOR');
  await appendProductionTimeline({ item, eventType: 'VENDOR_SUBMISSION_SENT', authContext });
  return toProductionTaskDto(updated);
}

async function listTaskSummariesByOrderItemIds(orderItemIds = [], authContext) {
  const uniqueIds = unique(orderItemIds.map(toId));
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  const tasks = await attachOrderSnapshots(await repository.listSummariesByOrderItemIds(uniqueIds));
  tasks.forEach((task) => assertCanAccessShop(task.shopId, productionPermissions.READ, authContext));
  return (await attachProductionUsers(tasks)).map(toProductionTaskSummaryDto);
}

async function getScaleAssignees(query = {}, authContext) {
  if (!isSystemContext(authContext) && !hasPermission(authContext, productionPermissions.READ)) {
    throw forbidden();
  }
  const profiles = await authPublic.listAssignableProfiles({
    search: query.search,
    limit: Math.min(Number(query.limit || 50), 100),
    requiredPermission: productionPermissions.WRITE,
  });
  return {
    items: (profiles || []).map((profile) => ({
      id: toId(profile.accountId),
      fullName: profile.fullName || null,
      employeeCode: profile.employeeCode || null,
    })),
  };
}

module.exports = {
  assignDesignTask,
  bulkAssignDesignTasks,
  claimDesignTask,
  createOrRecheckTaskForOrderItem,
  getTaskById,
  getTaskByOrderItem,
  getScaleAssignees,
  listPsdBlockedTasksByListing,
  listTasks,
  listTaskSummariesByOrderItemIds,
  markSentToVendor,
  recheckPsdBlockedTasks,
  summarizeTasks,
  submitQc,
  updateDesignNote,
  uploadScaledFile,
};
