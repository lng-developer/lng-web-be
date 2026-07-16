const fs = require('fs');
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
const organizationPublic = require('../../organization/public');
const shopPublic = require('../../shop/public');
const {
  productionBlockers,
  productionCsStatuses,
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
const SCALE_ASSIGNMENT_TEAM_CODE = 'DESIGN';
const DESIGN_WORK_PERMISSION = 'DESIGN:WORK';
const DESIGN_REVIEW_PERMISSION = 'DESIGN:REVIEW';
const PRODUCTION_QUEUE_READ_PERMISSIONS = [
  productionPermissions.READ,
  productionPermissions.WRITE,
  DESIGN_WORK_PERMISSION,
  DESIGN_REVIEW_PERMISSION,
];
const SCALE_WORK_PERMISSIONS = [productionPermissions.WRITE, DESIGN_WORK_PERMISSION];
const QC_REVIEW_PERMISSIONS = [productionPermissions.WRITE, DESIGN_REVIEW_PERMISSION];
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
  return hasPermissionCode(permissions, permission);
}

function hasPermissionCode(permissions = [], permission) {
  return permissions.includes(permission) || (
    permission === productionPermissions.READ
    && permissions.includes(productionPermissions.WRITE)
  );
}

function hasAnyPermission(authContext = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(authContext, permission));
}

function isSystemContext(authContext = {}) {
  return authContext && authContext.system === true;
}

function hasScopedPermission(grantedPermissions = [], permission) {
  return hasPermissionCode(grantedPermissions, permission);
}

function getScopedShopIds(authContext = {}, permissions) {
  const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && requiredPermissions.some((permission) => hasScopedPermission(scope.permissions || [], permission))
    ))
    .map((scope) => String(scope.scopeId)))];
}

function canAccessScopedShop(authContext = {}, permission, shopId) {
  if (authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    return true;
  }
  return permission === productionPermissions.READ
    && (authContext.scopes || []).some((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && String(scope.scopeId) === String(shopId)
      && (scope.permissions || []).includes(productionPermissions.WRITE)
    ));
}

function assertCanAccessShopAny(shopId, permissions, authContext) {
  if (isSystemContext(authContext) || hasAnyPermission(authContext, permissions)) return;
  if (!authContext) throw forbidden();
  if (!permissions.some((permission) => canAccessScopedShop(authContext, permission, shopId))) {
    throw forbidden();
  }
}

function assertCanAccessShop(shopId, permission, authContext) {
  assertCanAccessShopAny(shopId, [permission], authContext);
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
    addressInvalid: 0,
    failed: 0,
    csUnassigned: 0,
    csAssigned: 0,
    byScaleStatus: {},
    byQcStatus: {},
    byAssignmentStatus: {},
    byCsStatus: {},
    bySalesChannelCode: {},
    blockers: {},
  };
}

function applyReadScope(query, authContext) {
  if (isSystemContext(authContext) || hasAnyPermission(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS)) {
    return query;
  }

  const scopedShopIds = getScopedShopIds(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS);
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
    toId(task?.csAssigneeId),
    toId(task?.orderSnapshot?.assignedStaffId),
  ]));
}

function collectShopIds(tasks = []) {
  return unique(tasks.map((task) => toId(task?.shopId)));
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
    csAssigneeUser: profileByAccountId.get(toId(task.csAssigneeId)) || null,
    orderOwnerUser: profileByAccountId.get(toId(task.orderSnapshot?.assignedStaffId)) || null,
    sellerUser: sellerByEmployeeCode.get(String(parseEmployeeCodeFromSku(task.orderItemSnapshot?.sku)).toUpperCase()) || null,
  } : task));
}

async function attachShops(tasks = []) {
  const shopIds = collectShopIds(tasks);
  if (!shopIds.length) return tasks;
  const shops = await Promise.all(shopIds.map((shopId) => shopPublic.findById(shopId).catch(() => null)));
  const byShopId = new Map(shops
    .filter(Boolean)
    .map((shop) => [toId(shop._id || shop.id), shop]));
  return tasks.map((task) => (task ? { ...task, shop: byShopId.get(toId(task.shopId)) || null } : task));
}

function assertDesignAssignable(task) {
  if (!DESIGN_ASSIGNABLE_STATUSES.includes(task.status)) {
    throw conflict('Production task is not assignable to design', { status: task.status });
  }
}

function normalizeSlotKey(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || null;
}

function normalizedInputKeys(input = {}) {
  return [input.key, input.name, input.label, input.imageName]
    .map(normalizeSlotKey)
    .filter(Boolean);
}

function customerImages(customization) {
  const imagesByAssetId = new Map((customization?.imageAssets || [])
    .filter((image) => image?.assetId)
    .map((image) => [String(image.assetId), image]));

  const linkedImages = (customization?.customerInputs?.images || [])
    .filter((image) => image?.assetId)
    .map((image) => ({
      ...(imagesByAssetId.get(String(image.assetId)) || {}),
      ...image,
    }));

  const seen = new Set();
  return [
    ...linkedImages,
    ...(customization?.imageAssets || []),
  ].filter((image) => {
    const key = image?.assetId && String(image.assetId);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstDesignAsset(template, type) {
  return (template?.designAssets || []).find((asset) => asset.type === type && asset.status !== 'INACTIVE') || null;
}

function imageFileName(image = {}) {
  if (!image) return null;
  return image.filename || image.imageName || image.buyerFilename || null;
}

function customerImageForSlot(images = [], slot = {}, index = 0) {
  const slotKey = normalizeSlotKey(slot.key);
  const acceptedKeys = (slot.acceptedFieldKeys || []).map(normalizeSlotKey).filter(Boolean);
  return images.find((image) => normalizeSlotKey(image.slotKey) === slotKey)
    || images.find((image) => normalizedInputKeys(image).some((key) => acceptedKeys.includes(key)))
    || images[index]
    || images[0]
    || null;
}

function baseFileCheck({
  slotKey,
  slotLabel,
  required,
  sourceType,
  inputAssetId,
  inputSourceLabel,
  inputSlotKey,
  inputImageName,
  blockers,
}) {
  const missingInput = required && !inputAssetId;
  const needsScaledOutput = sourceType === productionSourceTypes.CUSTOMER_IMAGE;
  const nextBlockers = unique([
    ...(blockers || []),
    ...(missingInput ? [sourceType === productionSourceTypes.PSD_TEMPLATE
      ? productionBlockers.PSD_MISSING
      : productionBlockers.CUSTOMER_IMAGE_MISSING] : []),
    ...(needsScaledOutput && inputAssetId ? [productionBlockers.SCALED_OUTPUT_MISSING] : []),
  ]);

  return {
    slotKey,
    slotLabel,
    required,
    sourceType,
    inputAssetId,
    inputSourceLabel: inputSourceLabel || null,
    inputSlotKey: inputSlotKey || null,
    inputImageName: inputImageName || null,
    outputAssetId: null,
    scaleStatus: needsScaledOutput && inputAssetId ? productionScaleStatuses.NEED_SCALE : productionScaleStatuses.NOT_REQUIRED,
    qcStatus: productionQcStatuses.NOT_READY,
    blockers: nextBlockers,
    note: null,
  };
}

function buildFileChecks({ listing, template, customization }) {
  const images = customerImages(customization);
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
    const image = customerImageForSlot(images, slot, index);
    checks.push(baseFileCheck({
      slotKey: slot.key,
      slotLabel: slot.label || slot.key,
      required: Boolean(slot.required),
      sourceType: productionSourceTypes.CUSTOMER_IMAGE,
      inputAssetId: image?.assetId || null,
      inputSourceLabel: image?.label || image?.name || null,
      inputSlotKey: image?.slotKey || null,
      inputImageName: imageFileName(image),
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

  const requiredChecks = fileChecks.filter((check) => (
    check.required && check.sourceType !== productionSourceTypes.PSD_TEMPLATE
  ));
  const manualScaledChecks = fileChecks.filter((check) => (
    !check.required
    && check.sourceType === productionSourceTypes.CUSTOMER_IMAGE
    && check.outputAssetId
  ));
  if (!requiredChecks.length) {
    if (manualScaledChecks.length) {
      return {
        status: productionTaskStatuses.QC_PENDING,
        scaleStatus: productionScaleStatuses.SCALED,
        qcStatus: productionQcStatuses.PENDING,
        blockers: [],
      };
    }
    return {
      status: productionTaskStatuses.NEED_SCALE,
      scaleStatus: productionScaleStatuses.NEED_SCALE,
      qcStatus: productionQcStatuses.NOT_READY,
      blockers: [],
    };
  }
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

async function filterDesignTeamProfiles(profiles = []) {
  const accountIds = profiles.map((profile) => toId(profile.accountId)).filter(Boolean);
  if (!accountIds.length) {
    return [];
  }

  const organizations = await organizationPublic.listAccountOrganizationSummaries(accountIds);
  const designTeamAccountIds = new Set(
    organizations
      .filter((organization) => organization.team?.code === SCALE_ASSIGNMENT_TEAM_CODE)
      .map((organization) => toId(organization.accountId)),
  );

  return profiles.filter((profile) => designTeamAccountIds.has(toId(profile.accountId)));
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
    imageAssets: (customization.imageAssets || []).map((asset) => ({
      assetId: asset.assetId || asset.id || asset._id || null,
      filename: asset.filename || asset.originalFilename || null,
      mimeType: asset.mimeType || null,
      size: asset.size || null,
    })),
    failedImages: customization.failedImages || [],
  };
}

function toRefSnapshot(value) {
  if (!value) return null;
  if (typeof value !== 'object') return { id: toId(value) };
  return {
    id: toId(value),
    code: value.code || null,
    name: value.name || null,
    status: value.status || null,
  };
}

function toListingSnapshot(listing) {
  if (!listing) return null;
  return {
    id: toId(listing),
    sku: listing.sku || null,
    asin: listing.asin || null,
    title: listing.title || null,
    productTypeGroupId: toRefSnapshot(listing.productTypeGroupId),
    psdTemplateAssetId: toId(listing.psdTemplateAssetId),
    psdStatus: listing.psdStatus || null,
  };
}

function toTemplateSnapshot(template) {
  if (!template) return null;
  return {
    id: toId(template),
    code: template.code || null,
    name: template.name || null,
    productTypeGroupId: toRefSnapshot(template.productTypeGroupId),
    artworkSlots: template.artworkSlots || [],
    designAssets: template.designAssets || [],
    requiredFields: template.requiredFields || [],
    status: template.status || null,
  };
}

function toOrderSnapshot(order) {
  if (!order) return null;
  return {
    id: toId(order._id || order.id),
    status: order.status || null,
    assignedStaffId: toId(order.assignedStaffId),
    externalAccountId: order.externalAccountId || null,
    orderedAt: order.orderedAt || null,
    shipByDate: order.shipByDate || null,
    addressValidationStatus: order.addressValidationStatus || null,
    shippingAddress: order.shippingAddress || null,
    shippingService: order.shippingService || null,
  };
}

function productImageUrlFrom(item = {}, listing = {}) {
  return item.productImageUrl
    || item.imageUrl
    || item.externalData?.productImageUrl
    || item.externalData?.imageUrl
    || listing?.productImageUrl
    || listing?.thumbnailUrl
    || listing?.thumbnailAsset?.secureUrl
    || null;
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
      productImageUrl: productImageUrlFrom(item, listing),
    },
    listingSnapshot: toListingSnapshot(listing || plan.listing),
    templateSnapshot: toTemplateSnapshot(template || plan.internalTemplate),
    customizationSnapshot: toCustomizationSnapshot(customization),
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

async function attachVendorSubmissions(tasks = []) {
  const taskIds = unique(tasks.map(toId));
  if (!taskIds.length) return tasks;
  try {
    const vendorSubmissionPublic = require('../../vendorSubmission/public');
    if (typeof vendorSubmissionPublic.listLatestByProductionTaskIds !== 'function') return tasks;
    const submissions = await vendorSubmissionPublic.listLatestByProductionTaskIds(taskIds);
    const byTaskId = new Map((submissions || []).map((submission) => [toId(submission.productionTaskId), submission]));
    return tasks.map((task) => (task ? {
      ...task,
      vendorSubmission: byTaskId.get(toId(task)) || null,
    } : task));
  } catch (error) {
    logger.warn('Vendor submission enrichment skipped', { error });
    return tasks;
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
  const templateId = plan.internalTemplate?.id || toId(listing?.internalTemplateId);
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
    csAssigneeId: existing?.csAssigneeId || null,
    csAssignedBy: existing?.csAssignedBy || null,
    csAssignedAt: existing?.csAssignedAt || null,
    csStatus: existing?.csStatus || productionCsStatuses.UNASSIGNED,
    csNote: existing?.csNote || null,
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

  const [enrichedTask] = await attachVendorSubmissions(await attachProductionUsers(await attachShops([task])));
  return toProductionTaskDto(enrichedTask);
}

async function getTaskByOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  assertCanAccessShop(item.shopId, productionPermissions.READ, authContext);
  const [task] = await attachVendorSubmissions(await attachProductionUsers(await attachShops([
    ...(await attachOrderSnapshots([
      await attachCustomizationSnapshot(await repository.findByOrderItem(orderItemId), authContext),
    ])),
  ])));
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

async function recheckPsdBlockedTasksByListing(listingId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  const tasks = await repository.listPsdBlockedByListingId(listingId);
  const items = [];

  for (const task of tasks || []) {
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
    failed: items.filter((item) => item.status === 'FAILED').length,
    items,
  };
}

async function getTaskById(taskId, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.READ, authContext);
  const [enrichedTask] = await attachVendorSubmissions(await attachProductionUsers(await attachShops([
    ...(await attachOrderSnapshots([
      await attachCustomizationSnapshot(task, authContext),
    ])),
  ])));
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
  if (query.csUnassigned === true || query.csUnassigned === 'true') {
    result.csAssigneeId = null;
  } else if (query.csAssigneeId) {
    assertValidObjectId(query.csAssigneeId, 'csAssigneeId');
    result.csAssigneeId = query.csAssigneeId;
  }
  if (query.csStatus) {
    result.csStatus = String(query.csStatus).trim().toUpperCase();
  }
  if (query.sellerCode) result.sellerCode = String(query.sellerCode).trim().toUpperCase();
  if (query.tab) result.tab = String(query.tab).trim().toUpperCase();
  return result;
}

async function listTasks(query = {}, authContext) {
  const startedAt = Date.now();
  const normalizedQuery = normalizeListQuery(query);
  const scopedQuery = applyReadScope(normalizedQuery, authContext);
  if (!scopedQuery) return emptyTaskList(normalizedQuery);
  const result = await repository.list(scopedQuery);
  const items = await attachVendorSubmissions(await attachProductionUsers(await attachShops(await attachOrderSnapshots(
    await attachCustomizationSnapshots(result.items, authContext),
  ))));
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

async function addManualFileCheck(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShopAny(task.shopId, SCALE_WORK_PERMISSIONS, authContext);

  const slotKey = normalizeSlotKey(payload.slotKey);
  if (!slotKey) {
    throw new AppError('slotKey is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, {
      field: 'slotKey',
    });
  }
  if ((task.fileChecks || []).some((check) => normalizeSlotKey(check.slotKey) === slotKey)) {
    throw conflict('Production file check already exists for slotKey', { slotKey });
  }

  const inputAssetId = payload.inputAssetId || null;
  if (inputAssetId) await mediaPublic.assertMediaAssetExists(inputAssetId);

  const fileChecks = [
    ...(task.fileChecks || []),
    {
      slotKey,
      slotLabel: payload.slotLabel || slotKey,
      required: false,
      sourceType: payload.sourceType || productionSourceTypes.CUSTOMER_IMAGE,
      inputAssetId,
      outputAssetId: null,
      scaleStatus: inputAssetId ? productionScaleStatuses.NEED_SCALE : productionScaleStatuses.NOT_REQUIRED,
      qcStatus: productionQcStatuses.NOT_READY,
      blockers: inputAssetId ? [productionBlockers.SCALED_OUTPUT_MISSING] : [],
      note: null,
    },
  ];
  const aggregate = aggregateStatus(fileChecks);
  const updated = await repository.updateById(taskId, { fileChecks, ...aggregate });

  await transitionOrderItemStatus(task.orderItemId, orderItemStatusForProductionAggregate(aggregate, 'manual'));
  await appendTaskTimeline(task, 'PRODUCTION_MANUAL_FILE_CHECK_ADDED', authContext);
  return toProductionTaskDto(updated);
}

async function uploadScaledFile(taskId, fileCheckId, mediaAssetId, authContext) {
  assertValidObjectId(mediaAssetId, 'mediaAssetId');
  const task = await loadTask(taskId);
  assertCanAccessShopAny(task.shopId, SCALE_WORK_PERMISSIONS, authContext);
  await mediaPublic.assertMediaAssetExists(mediaAssetId);

  const fileChecks = (task.fileChecks || []).map((check) => {
    if (toId(check) !== fileCheckId) return check;
    return {
      ...check,
      outputAssetId: mediaAssetId,
      scaleStatus: productionScaleStatuses.SCALED,
      qcStatus: productionQcStatuses.PENDING,
      blockers: (check.blockers || []).filter((blocker) => ![
        productionBlockers.SCALED_OUTPUT_MISSING,
        productionBlockers.CUSTOMER_IMAGE_MISSING,
      ].includes(blocker)),
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

async function removeTempUpload(file) {
  if (file?.path) await fs.promises.rm(file.path, { force: true, maxRetries: 3, retryDelay: 50 });
}

async function uploadScaledOutputFile(taskId, fileCheckId, file, authContext) {
  if (!file?.path) {
    throw new AppError('file is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, {
      field: 'file',
    });
  }

  try {
    const mediaAsset = await mediaPublic.storeAsset({
      stream: fs.createReadStream(file.path),
      filename: file.originalname,
      mimeType: file.mimetype || null,
      metadata: {
        source: 'PRODUCTION_SCALED_OUTPUT',
        taskId,
        fileCheckId,
        uploadedBy: authContext?.accountId || null,
      },
      maxBytes: file.size || Number(process.env.MEDIA_UPLOAD_MAX_BYTES || 200 * 1024 * 1024),
    });
    return uploadScaledFile(taskId, fileCheckId, mediaAsset._id || mediaAsset.id, authContext);
  } finally {
    await removeTempUpload(file);
  }
}

async function addManualScaledOutputFile(taskId, payload = {}, file, authContext) {
  if (!file?.path) {
    throw new AppError('file is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, {
      field: 'file',
    });
  }

  const slotKey = normalizeSlotKey(payload.slotKey);
  if (!slotKey) {
    throw new AppError('slotKey is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, {
      field: 'slotKey',
    });
  }

  try {
    const task = await loadTask(taskId);
    assertCanAccessShopAny(task.shopId, SCALE_WORK_PERMISSIONS, authContext);
    let fileCheckId = toId((task.fileChecks || []).find((check) => normalizeSlotKey(check.slotKey) === slotKey));

    if (!fileCheckId) {
      const updated = await addManualFileCheck(taskId, { ...payload, slotKey }, authContext);
      fileCheckId = toId((updated.fileChecks || []).find((check) => normalizeSlotKey(check.slotKey) === slotKey));
    }

    if (!fileCheckId) {
      throw notFound('Production file check not found');
    }

    return uploadScaledOutputFile(taskId, fileCheckId, file, authContext);
  } catch (error) {
    await removeTempUpload(file);
    throw error;
  }
}

async function assertAssignableAccount(accountId, requiredPermission, message, filterProfiles = null) {
  const profiles = await authPublic.listAssignableProfiles({
    accountIds: [accountId],
    limit: 1,
    requiredPermission,
  });
  const assignableProfiles = filterProfiles ? await filterProfiles(profiles) : profiles;

  if (!assignableProfiles.length) {
    throw new AppError(
      message,
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
  await assertAssignableAccount(
    payload.assignedDesignUserId,
    DESIGN_WORK_PERMISSION,
    'Assigned user is not eligible for scale design tasks',
    filterDesignTeamProfiles,
  );
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

async function assignCsTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  const assigneeId = payload.csAssigneeId || null;

  if (!assigneeId) {
    const patch = {
      csAssigneeId: null,
      csAssignedBy: null,
      csAssignedAt: null,
      csStatus: productionCsStatuses.UNASSIGNED,
    };
    if (Object.prototype.hasOwnProperty.call(payload, 'csNote')) {
      patch.csNote = payload.csNote || null;
    }
    const updated = await repository.updateById(taskId, patch);
    await appendTaskTimeline(task, 'PRODUCTION_CS_UNASSIGNED', authContext);
    return toProductionTaskDto(updated);
  }

  assertValidObjectId(assigneeId, 'csAssigneeId');
  await assertAssignableAccount(
    assigneeId,
    productionPermissions.WRITE,
    'Assigned user is not eligible for production CS tasks',
  );
  const patch = {
    csAssigneeId: assigneeId,
    csAssignedBy: authContext?.accountId || null,
    csAssignedAt: new Date(),
    csStatus: productionCsStatuses.ASSIGNED,
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'csNote')) {
    patch.csNote = payload.csNote || null;
  }
  const updated = await repository.updateById(taskId, patch);
  await appendTaskTimeline(task, 'PRODUCTION_CS_ASSIGNED', authContext);
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
  assertCanAccessShopAny(task.shopId, SCALE_WORK_PERMISSIONS, authContext);
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

async function updateCsNote(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  const updated = await repository.updateById(taskId, {
    csNote: payload.csNote || null,
  });
  await appendTaskTimeline(task, 'PRODUCTION_CS_NOTE_UPDATED', authContext);
  return toProductionTaskDto(updated);
}

async function updateCsStatus(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  const csStatus = String(payload.csStatus || '').trim().toUpperCase();
  if (![productionCsStatuses.UNASSIGNED, productionCsStatuses.ASSIGNED].includes(csStatus) && !task.csAssigneeId) {
    throw conflict('CS assignee is required before progressing CS status', { csStatus });
  }
  const patch = { csStatus };
  if (csStatus === productionCsStatuses.UNASSIGNED) {
    patch.csAssigneeId = null;
    patch.csAssignedBy = null;
    patch.csAssignedAt = null;
  }
  const updated = await repository.updateById(taskId, patch);
  await appendTaskTimeline(task, 'PRODUCTION_CS_STATUS_UPDATED', authContext);
  return toProductionTaskDto(updated);
}

async function submitQc(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShopAny(task.shopId, QC_REVIEW_PERMISSIONS, authContext);
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
      vendorSubmissionId: toId(task.vendorSubmissionId),
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

async function bulkPushVendor(payload = {}, authContext) {
  const sent = [];
  const failed = [];
  const vendorSubmissionIdsByTaskId = payload.vendorSubmissionIdsByTaskId || {};

  for (const taskId of payload.taskIds || []) {
    try {
      assertValidObjectId(taskId, 'taskId');
      sent.push(await markSentToVendor(taskId, vendorSubmissionIdsByTaskId[taskId] || null, authContext));
    } catch (error) {
      failed.push(toBulkAssignFailure(taskId, error));
    }
  }

  return { sent, failed };
}

function excelEscape(value) {
  if (value === undefined || value === null) return '';
  return String(value instanceof Date ? value.toISOString() : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excelRow(cells = []) {
  return `<Row>${cells.map((cell) => `<Cell><Data ss:Type="String">${excelEscape(cell)}</Data></Cell>`).join('')}</Row>`;
}

function excelWorkbook(headers = [], rows = []) {
  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Worksheet ss:Name="QC Tasks"><Table>',
    excelRow(headers),
    ...rows.map(excelRow),
    '</Table></Worksheet></Workbook>',
  ].join('');
}

function exportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function exportQcTasksExcel(query = {}, authContext) {
  const normalizedQuery = normalizeListQuery(query);
  const scopedQuery = applyReadScope(normalizedQuery, authContext);
  const headers = ['Task ID', 'Shop', 'Order ID', 'SKU', 'Title', 'QC Status', 'Production Status', 'Scale Status', 'Order Date', 'Shipping Type', 'Fulfill Name', 'Seller', 'Vendor Submission'];

  if (!scopedQuery) {
    return {
      filename: `production-qc-tasks-${exportDateStamp()}.xls`,
      contentType: 'application/vnd.ms-excel; charset=utf-8',
      content: excelWorkbook(headers),
    };
  }

  const tasks = await attachVendorSubmissions(await attachProductionUsers(await attachShops(await attachOrderSnapshots(
    await attachCustomizationSnapshots(await repository.listForExport(scopedQuery), authContext),
  ))));
  const rows = tasks.map((task) => {
    const dto = toProductionTaskSummaryDto(task);
    return [
      dto.id,
      dto.shopName,
      dto.orderItem?.externalOrderId,
      dto.orderItem?.sku,
      dto.orderItem?.title,
      dto.qcStatus,
      dto.productionStatus,
      dto.scaleStatus,
      dto.orderDate,
      dto.shippingType,
      dto.fulfillName,
      dto.seller?.employeeCode,
      dto.vendorSubmission?.status,
    ];
  });

  return {
    filename: `production-qc-tasks-${exportDateStamp()}.xls`,
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    content: excelWorkbook(headers, rows),
  };
}

async function listTaskSummariesByOrderItemIds(orderItemIds = [], authContext) {
  const uniqueIds = unique(orderItemIds.map(toId));
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  const tasks = await attachOrderSnapshots(await repository.listSummariesByOrderItemIds(uniqueIds));
  tasks.forEach((task) => assertCanAccessShop(task.shopId, productionPermissions.READ, authContext));
  return (await attachVendorSubmissions(await attachProductionUsers(await attachShops(tasks)))).map(toProductionTaskSummaryDto);
}

async function getScaleAssignees(query = {}, authContext) {
  if (!isSystemContext(authContext) && !hasAnyPermission(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS)) {
    throw forbidden();
  }
  const profiles = await authPublic.listAssignableProfiles({
    search: query.search,
    limit: Math.min(Number(query.limit || 50), 100),
    requiredPermission: DESIGN_WORK_PERMISSION,
  });
  const designTeamProfiles = await filterDesignTeamProfiles(profiles || []);
  return {
    items: designTeamProfiles.map((profile) => ({
      id: toId(profile.accountId),
      fullName: profile.fullName || null,
      employeeCode: profile.employeeCode || null,
    })),
  };
}

async function getCsAssignees(query = {}, authContext) {
  if (!isSystemContext(authContext) && !hasAnyPermission(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS)) {
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
  addManualFileCheck,
  addManualScaledOutputFile,
  assignCsTask,
  assignDesignTask,
  bulkAssignDesignTasks,
  bulkPushVendor,
  claimDesignTask,
  createOrRecheckTaskForOrderItem,
  exportQcTasksExcel,
  getCsAssignees,
  getTaskById,
  getTaskByOrderItem,
  getScaleAssignees,
  listPsdBlockedTasksByListing,
  listTasks,
  listTaskSummariesByOrderItemIds,
  markSentToVendor,
  recheckPsdBlockedTasks,
  recheckPsdBlockedTasksByListing,
  summarizeTasks,
  submitQc,
  updateCsNote,
  updateCsStatus,
  updateDesignNote,
  uploadScaledFile,
  uploadScaledOutputFile,
};
