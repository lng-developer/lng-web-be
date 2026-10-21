const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { normalizePagination } = require('../../../shared/utils/pagination');
const logger = require('../../../shared/utils/logger');
const authPublic = require('../../auth/public');
const hrPublic = require('../../hr/public');
const catalogPublic = require('../../catalog/public');
const customizationPublic = require('../../customization/public');
const mappingPublic = require('../../mapping/public');
const mediaPublic = require('../../media/public');
const notificationPublic = require('../../notification/public');
const orderPublic = require('../../order/public');
const organizationPublic = require('../../organization/public');
const shopPublic = require('../../shop/public');
const auditPublic = require('../../audit/public');
const workScorePublic = require('../../workScore/public');
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
  toQcTaskSummaryDto,
  toProductionTaskDto,
  toProductionTaskSummaryDto,
} = require('../dtos/productionTask.dto');

const SHOP_SCOPE_TYPE = 'shop';
const DESIGN_WORK_PERMISSION = 'DESIGN:WORK';
const DESIGN_REVIEW_PERMISSION = 'DESIGN:REVIEW';
const { addressValidationStatuses } = orderPublic;

async function notifyAssignedDesigner(task, { type, title, message, version }) {
  const recipientAccountId = toId(task?.assignedDesignUserId);
  if (!recipientAccountId) return;
  const resourceId = toId(task);
  const transitionVersion = version ? new Date(version).toISOString() : 'unknown';
  await notificationPublic.notify({
    recipientAccountId,
    type,
    title,
    message,
    relatedResource: { type: 'productionTask', id: resourceId },
    deduplicationKey: `${type}:${resourceId}:${recipientAccountId}:${transitionVersion}`,
  });
}
const PRODUCTION_QUEUE_READ_PERMISSIONS = [
  productionPermissions.READ,
  productionPermissions.WRITE,
  productionPermissions.SCALE_WORK,
  productionPermissions.SCALE_ASSIGN,
  productionPermissions.QC_REVIEW,
  DESIGN_WORK_PERMISSION,
  DESIGN_REVIEW_PERMISSION,
];
const SCALE_WORK_PERMISSIONS = [productionPermissions.WRITE, productionPermissions.SCALE_WORK];
const QC_REVIEW_PERMISSIONS = [productionPermissions.WRITE, productionPermissions.QC_REVIEW];
const DESIGN_TASK_WORK_PERMISSIONS = [productionPermissions.WRITE, DESIGN_WORK_PERMISSION];
const DESIGN_ASSIGNABLE_STATUSES = [
  productionTaskStatuses.BLOCKED,
  productionTaskStatuses.NEED_SCALE,
  productionTaskStatuses.QC_REJECTED,
];
const REQUIRED_SCALED_OUTPUT_STORAGE_PROVIDER = String(
  process.env.PRODUCTION_SCALED_OUTPUT_STORAGE_PROVIDER || 'cloudinary',
).trim().toLowerCase();
const SCALE_READY_ADDRESS_STATUSES = new Set([
  addressValidationStatuses.VALID,
  addressValidationStatuses.OVERRIDDEN,
]);
const SCALE_MUTATION_LOCKED_STATUSES = new Set([
  productionTaskStatuses.READY_TO_SEND_VENDOR,
  productionTaskStatuses.SENT_TO_VENDOR,
  productionTaskStatuses.CANCELLED,
]);
const RECHECK_TERMINAL_STATUSES = new Set([
  productionTaskStatuses.QC_REJECTED,
  productionTaskStatuses.SENT_TO_VENDOR,
  productionTaskStatuses.CANCELLED,
]);
const LIST_ENRICHMENT_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.PRODUCTION_LIST_ENRICHMENT_CACHE_TTL_MS || 60000),
);
const shopEnrichmentCache = new Map();
const employeeAccountEnrichmentCache = new Map();
const employeeCodeEnrichmentCache = new Map();
const variantDifficultyEnrichmentCache = new Map();

async function syncWorkbenchProduction(task, session = null) {
  const production = toProductionTaskSummaryDto(task);
  if (!production?.orderItemId || !task?.orderId) return;
  await orderPublic.updateOrderWorkbenchItem(
    task.orderId,
    production.orderItemId,
    { production },
    { source: 'PRODUCTION', ...(session ? { session } : {}) },
  );
}

async function recordProductionOperation({
  action, task, authContext = {}, changes = null, metadata = {}, session = null,
}) {
  await syncWorkbenchProduction(task, session);
  const isSystem = authContext.system === true;
  const isHttp = !isSystem && Boolean(authContext.auditContext);
  const requestedActorType = authContext.auditActorType
    || (isHttp && authContext.accountId ? 'ACCOUNT' : 'SYSTEM');
  const actorType = requestedActorType === 'ACCOUNT' && authContext.accountId ? 'ACCOUNT' : 'SYSTEM';
  const actorAccountId = actorType === 'ACCOUNT' ? authContext.accountId : null;
  const source = authContext.auditSource
    || (isSystem ? 'SYSTEM' : (isHttp ? 'HTTP' : (authContext.worker ? 'WORKER' : (authContext.import ? 'IMPORT' : 'SYSTEM'))));
  const httpContext = authContext.auditContext || {};
  try {
    return await auditPublic.record({
      actorType,
      actorAccountId,
      actorSnapshot: {},
      action,
      entityType: 'PRODUCTION_TASK',
      entityId: toId(task),
      scopeType: task.shopId ? 'SHOP' : null,
      scopeId: task.shopId ? toId(task.shopId) : null,
      outcome: 'SUCCEEDED',
      source,
      requestId: httpContext.requestId || null,
      ipAddress: httpContext.ipAddress || null,
      userAgent: httpContext.userAgent || null,
      changes,
      metadata,
      deduplicationKey: `operations:${action.toLowerCase()}:${toId(task)}:${crypto.randomUUID()}`,
    }, { session });
  } catch (error) {
    if (session) throw error;
    // ponytail: best-effort because these legacy mutation paths do not own Mongo sessions.
    logger.warn('Operation audit write failed after mutation commit', { action, entityId: toId(task), error });
    return null;
  }
}

async function withProductionOperation(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict(message, details) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, details);
}

function assertScaleMutationAllowed(task) {
  if (
    SCALE_MUTATION_LOCKED_STATUSES.has(task.status)
    || task.qcStatus === productionQcStatuses.PASSED
  ) {
    throw conflict('Scaled outputs cannot be changed after QC has passed', {
      status: task.status,
      qcStatus: task.qcStatus,
    });
  }
}

function forbidden(message = 'Forbidden') {
  return appError(message, httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function assertScaledOutputStorageProvider() {
  if (!REQUIRED_SCALED_OUTPUT_STORAGE_PROVIDER) return;
  if (typeof mediaPublic.getStorageProvider !== 'function') return;
  const currentProvider = mediaPublic.getStorageProvider();
  if (currentProvider !== REQUIRED_SCALED_OUTPUT_STORAGE_PROVIDER) {
    throw appError(
      `Production scaled output storage provider must be ${REQUIRED_SCALED_OUTPUT_STORAGE_PROVIDER}`,
      httpStatus.CONFLICT,
      errorCodes.CONFLICT_ERROR,
      { currentProvider, requiredProvider: REQUIRED_SCALED_OUTPUT_STORAGE_PROVIDER },
    );
  }
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

function hasAnyGlobalPermission(authContext = {}, permissions = []) {
  const granted = authContext.permissions || [];
  return permissions.some((permission) => hasPermissionCode(granted, permission));
}

function isSystemContext(authContext = {}) {
  return authContext && authContext.system === true;
}

function hasScopedPermission(grantedPermissions = [], permission) {
  return hasPermissionCode(grantedPermissions, permission);
}

function hasAnyScopedPermission(authContext = {}, permissions = []) {
  const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
  return (authContext.scopes || []).some((scope) => (
    requiredPermissions.some((permission) => hasScopedPermission(scope.permissions || [], permission))
  ));
}

function hasAnyTeamScopedPermission(authContext = {}, permissions = []) {
  const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
  return (authContext.scopes || []).some((scope) => (
    String(scope.scopeType).toLowerCase() === 'team'
    && requiredPermissions.some((permission) => hasScopedPermission(scope.permissions || [], permission))
  ));
}

function hasTeamQueueScope(authContext = {}) {
  return authPublic.hasTeamQueueScope(authContext, {
    permissions: [DESIGN_REVIEW_PERMISSION, productionPermissions.WRITE],
  });
}

function canReadProductionQueue(authContext = {}) {
  return isSystemContext(authContext)
    || hasAnyPermission(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS)
    || hasAnyScopedPermission(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS)
    || hasTeamQueueScope(authContext);
}

function isAssignedScaleWorker(task = {}, authContext = {}) {
  return Boolean(authContext.accountId)
    && toId(task.csAssigneeId) === String(authContext.accountId)
    && (hasPermission(authContext, productionPermissions.SCALE_WORK)
      || hasAnyScopedPermission(authContext, [productionPermissions.SCALE_WORK]));
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

async function teamScopedDesignAccountIds(authContext = {}) {
  return authPublic.listTeamScopedAccountIds(authContext, [DESIGN_WORK_PERMISSION, DESIGN_REVIEW_PERMISSION]);
}

function isAssignedDesigner(task, authContext = {}) {
  return Boolean(authContext.accountId)
    && toId(task.assignedDesignUserId) === String(authContext.accountId)
    && (hasPermission(authContext, DESIGN_WORK_PERMISSION)
      || hasAnyScopedPermission(authContext, [DESIGN_WORK_PERMISSION]));
}

function assertCanScaleTask(task, authContext) {
  if (isAssignedDesigner(task, authContext) || isAssignedScaleWorker(task, authContext)) return;
  assertCanAccessShopAny(task.shopId, SCALE_WORK_PERMISSIONS, authContext);
}

async function assertCanReviewTask(task, authContext) {
  if (hasAnyTeamScopedPermission(authContext, QC_REVIEW_PERMISSIONS)) return;
  assertCanAccessShopAny(task.shopId, QC_REVIEW_PERMISSIONS, authContext);
}

async function assertCanAssignDesignTask(task, assignedDesignUserId, authContext = {}) {
  if (isSystemContext(authContext) || hasAnyGlobalPermission(authContext, [productionPermissions.WRITE])) return;
  if (!hasTeamQueueScope(authContext)) {
    assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
    return;
  }

  const accountIds = await teamScopedDesignAccountIds(authContext);
  if (!accountIds.includes(String(assignedDesignUserId))) throw forbidden();
  const currentAssigneeId = toId(task.assignedDesignUserId);
  if (currentAssigneeId && !accountIds.includes(currentAssigneeId)) throw forbidden();
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
    scaleQueue: 0,
    qcQueue: 0,
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

function emptyQueueCounts() {
  return { total: 0, blocked: 0, scaleQueue: 0, needScale: 0, qcRejected: 0, qcPending: 0, qcQueue: 0, ready: 0, sent: 0, cancelled: 0, unclassified: 0 };
}

async function applyReadScope(query, authContext) {
  const sellerOrderItemIds = await orderPublic.personalSellerItemIds?.(authContext, productionPermissions.READ);
  if (sellerOrderItemIds !== undefined) return { ...query, sellerOrderItemIds };
  if (isSystemContext(authContext) || hasAnyGlobalPermission(authContext, [productionPermissions.WRITE])) {
    return query;
  }

  if (query.view === 'QC') {
    if (hasAnyGlobalPermission(authContext, QC_REVIEW_PERMISSIONS)
      || hasAnyTeamScopedPermission(authContext, QC_REVIEW_PERMISSIONS)) return query;
    if (hasAnyTeamScopedPermission(authContext, [DESIGN_REVIEW_PERMISSION])) {
      const accountIds = await authPublic.listTeamScopedAccountIds(authContext, [DESIGN_REVIEW_PERMISSION]);
      const shopIds = getScopedShopIds(authContext, QC_REVIEW_PERMISSIONS);
      return accountIds.length || shopIds.length ? {
        ...query, qcTeamAccountIds: accountIds,
        ...(shopIds.length ? { qcReadShopIds: shopIds } : {}),
      } : null;
    }
  }

  if (hasAnyPermission(authContext, [productionPermissions.SCALE_ASSIGN])
    || hasAnyTeamScopedPermission(authContext, [productionPermissions.SCALE_ASSIGN])) {
    return { ...query, scaleQueueOnly: true };
  }

  if (hasAnyPermission(authContext, [productionPermissions.QC_REVIEW])
    || hasAnyTeamScopedPermission(authContext, [productionPermissions.QC_REVIEW])) {
    return { ...query, qcQueueOnly: true };
  }

  if (authContext?.accountId && (
    hasAnyPermission(authContext, [productionPermissions.SCALE_WORK])
    || hasAnyTeamScopedPermission(authContext, [productionPermissions.SCALE_WORK])
  )) {
    if (query.csAssigneeId && String(query.csAssigneeId) !== String(authContext.accountId)) return null;
    return { ...query, csAssigneeId: authContext.accountId };
  }

  if (hasAnyGlobalPermission(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS)) return query;

  if (hasTeamQueueScope(authContext)) {
    const accountIds = await teamScopedDesignAccountIds(authContext);
    if (!accountIds.length) return null;
    if (query.assignedDesignUserId && !accountIds.includes(String(query.assignedDesignUserId))) return null;
    const scopedQuery = query.assignedDesignUserId ? query
      : { ...query, assignedDesignUserIds: accountIds, includeUnassignedDesignUser: true };
    if (hasAnyTeamScopedPermission(authContext, [DESIGN_REVIEW_PERMISSION])) {
      return { ...scopedQuery,
        qcTeamAccountIds: await authPublic.listTeamScopedAccountIds(authContext, [DESIGN_REVIEW_PERMISSION]),
        qcReadShopIds: getScopedShopIds(authContext, QC_REVIEW_PERMISSIONS), allowNonQcTasks: true,
      };
    }
    return scopedQuery;
  }

  const scopedShopIds = getScopedShopIds(authContext, PRODUCTION_QUEUE_READ_PERMISSIONS);
  if (scopedShopIds.length === 0) {
    if (
      authContext?.accountId
      && (hasAnyPermission(authContext, [DESIGN_WORK_PERMISSION])
        || hasAnyScopedPermission(authContext, [DESIGN_WORK_PERMISSION]))
    ) {
      return { ...query, assignedDesignUserId: authContext.accountId };
    }
    return null;
  }
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return null;
  if (query.shopId) return query;
  return { ...query, shopIds: scopedShopIds };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function readListEnrichmentCache(cache, key) {
  if (!LIST_ENRICHMENT_CACHE_TTL_MS) return undefined;
  const entry = cache.get(String(key));
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(String(key));
    return undefined;
  }
  return entry.value;
}

function writeListEnrichmentCache(cache, key, value) {
  if (!LIST_ENRICHMENT_CACHE_TTL_MS || value === undefined) return;
  cache.set(String(key), {
    value,
    expiresAt: Date.now() + LIST_ENRICHMENT_CACHE_TTL_MS,
  });
}

function clearListEnrichmentCachesForTest() {
  shopEnrichmentCache.clear();
  employeeAccountEnrichmentCache.clear();
  employeeCodeEnrichmentCache.clear();
  variantDifficultyEnrichmentCache.clear();
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
  const cachedProfiles = userIds.map((userId) => readListEnrichmentCache(employeeAccountEnrichmentCache, userId));
  const cachedSellerProfiles = sellerCodes.map((code) => readListEnrichmentCache(
    employeeCodeEnrichmentCache,
    String(code).toUpperCase(),
  ));
  const missingUserIds = userIds.filter((userId, index) => cachedProfiles[index] === undefined);
  const missingSellerCodes = sellerCodes.filter((code, index) => cachedSellerProfiles[index] === undefined);
  const [profiles, sellerProfiles] = await Promise.all([
    missingUserIds.length ? hrPublic.listEmployeeProfilesByAccountIds(missingUserIds) : [],
    missingSellerCodes.length
      ? hrPublic.listEmployeeProfilesByEmployeeCodes(missingSellerCodes)
      : [],
  ]);
  (profiles || []).forEach((profile) => {
    if (profile?.accountId) writeListEnrichmentCache(employeeAccountEnrichmentCache, profile.accountId, profile);
  });
  missingUserIds.forEach((userId) => {
    if (readListEnrichmentCache(employeeAccountEnrichmentCache, userId) === undefined) {
      writeListEnrichmentCache(employeeAccountEnrichmentCache, userId, null);
    }
  });
  (sellerProfiles || []).forEach((profile) => {
    if (profile?.employeeCode) {
      writeListEnrichmentCache(employeeCodeEnrichmentCache, String(profile.employeeCode).toUpperCase(), profile);
    }
  });
  missingSellerCodes.forEach((code) => {
    const key = String(code).toUpperCase();
    if (readListEnrichmentCache(employeeCodeEnrichmentCache, key) === undefined) {
      writeListEnrichmentCache(employeeCodeEnrichmentCache, key, null);
    }
  });
  const profileByAccountId = new Map((profiles || [])
    .concat(cachedProfiles.filter((profile) => profile !== undefined))
    .filter((profile) => profile?.accountId)
    .map((profile) => [String(profile.accountId), profile]));
  const sellerByEmployeeCode = new Map((sellerProfiles || [])
    .concat(cachedSellerProfiles.filter((profile) => profile !== undefined))
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
  const cachedShops = shopIds.map((shopId) => readListEnrichmentCache(shopEnrichmentCache, shopId));
  const missingShopIds = shopIds.filter((shopId, index) => cachedShops[index] === undefined);
  let shops = [];
  if (missingShopIds.length && typeof shopPublic.findByIds === 'function') {
    shops = await shopPublic.findByIds(missingShopIds).catch((error) => {
      logger.warn('Shop batch enrichment skipped', { error });
      return [];
    });
  } else if (missingShopIds.length) {
    shops = await Promise.all(missingShopIds.map((shopId) => shopPublic.findById(shopId).catch(() => null)));
  }
  (shops || []).forEach((shop) => {
    const shopId = toId(shop?._id || shop?.id);
    if (shopId) writeListEnrichmentCache(shopEnrichmentCache, shopId, shop);
  });
  missingShopIds.forEach((shopId) => {
    if (readListEnrichmentCache(shopEnrichmentCache, shopId) === undefined) {
      writeListEnrichmentCache(shopEnrichmentCache, shopId, null);
    }
  });
  const byShopId = new Map(shops
    .concat(cachedShops.filter((shop) => shop !== undefined))
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

const genericImageInputKeys = new Set(['CUSTOMIZATION_URL', 'CUSTOMIZED_URL']);

function customerImageInputs(customization) {
  return (customization?.customerInputs?.images || []).filter((image) => {
    const keys = normalizedInputKeys(image);
    const nonGenericKeys = keys.filter((key) => !genericImageInputKeys.has(key));
    const hasValue = image?.value !== undefined && image?.value !== null && String(image.value).trim() !== '';
    return Boolean(image?.assetId || nonGenericKeys.length || (hasValue && !keys.some((key) => genericImageInputKeys.has(key))));
  });
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
  return linkedImages.filter((image) => {
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
    || (images.length === 1 ? images[0] : null)
    || null;
}

function customerImageInputMatchesSlot(input = {}, slot = {}) {
  const slotKey = normalizeSlotKey(slot.key);
  const acceptedKeys = (slot.acceptedFieldKeys || []).map(normalizeSlotKey).filter(Boolean);
  const inputKeys = normalizedInputKeys(input);
  return (slotKey && inputKeys.includes(slotKey))
    || (acceptedKeys.length > 0 && inputKeys.some((key) => acceptedKeys.includes(key)));
}

function shouldRequireCustomerImageForSlot({ customization, slot, index, image }) {
  if (!slot?.required) return false;
  if (image?.assetId) return true;

  const inputs = customerImageInputs(customization);
  if (!inputs.length) return false;
  if (inputs.some((input) => customerImageInputMatchesSlot(input, slot))) return true;

  if (inputs.length > 1) return true;

  const acceptedKeys = (slot.acceptedFieldKeys || []).map(normalizeSlotKey).filter(Boolean);
  if (!normalizeSlotKey(slot.key) && !acceptedKeys.length) return true;
  return index < inputs.length && inputs.length === 1;
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
  const psdReadiness = listing?.psdReadiness || null;
  const psdAssetId = psdReadiness && Object.hasOwn(psdReadiness, 'effectivePsdAssetId')
    ? psdReadiness.effectivePsdAssetId
    : listing?.psdTemplateAssetId
    || listing?.defaultPsdTemplateAssetId
    || firstDesignAsset(template, 'PSD_TEMPLATE')?.mediaAssetId
    || null;
  const checks = [
    baseFileCheck({
      slotKey: 'PSD_TEMPLATE',
      slotLabel: 'PSD template',
      required: psdReadiness?.required !== false,
      sourceType: productionSourceTypes.PSD_TEMPLATE,
      inputAssetId: psdAssetId,
    }),
  ];

  (template?.artworkSlots || []).forEach((slot, index) => {
    const image = customerImageForSlot(images, slot, index);
    checks.push(baseFileCheck({
      slotKey: slot.key,
      slotLabel: slot.label || slot.key,
      required: shouldRequireCustomerImageForSlot({
        customization,
        slot,
        index,
        image,
      }),
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

function requiresScaledOutput(check = {}) {
  return check.required && check.sourceType !== productionSourceTypes.PSD_TEMPLATE;
}

function isScoredScaleOutput(check = {}) {
  return check.sourceType !== productionSourceTypes.PSD_TEMPLATE
    && check.qcStatus === productionQcStatuses.PASSED
    && Boolean(check.outputAssetId);
}

function preserveExistingScaledOutputs(fileChecks = [], existingFileChecks = []) {
  const existingBySlotKey = new Map((existingFileChecks || [])
    .map((check) => [`${normalizeSlotKey(check.slotKey)}:${check.sourceType}`, check]));

  return fileChecks.map((check) => {
    const existing = existingBySlotKey.get(`${normalizeSlotKey(check.slotKey)}:${check.sourceType}`);
    if (!existing || toId(existing.inputAssetId) !== toId(check.inputAssetId)) return check;

    const keepsQcState = Boolean(existing.outputAssetId)
      || [productionQcStatuses.PASSED, productionQcStatuses.REJECTED].includes(existing.qcStatus);

    return {
      ...check,
      _id: existing._id,
      outputAssetId: existing.outputAssetId || null,
      outputWorkerId: existing.outputWorkerId || null,
      scaleStatus: existing.outputAssetId
        ? existing.scaleStatus || productionScaleStatuses.SCALED
        : check.scaleStatus,
      qcStatus: keepsQcState ? existing.qcStatus : check.qcStatus,
      blockers: unique([
        ...(existing.outputAssetId
          ? (check.blockers || []).filter((blocker) => blocker !== productionBlockers.SCALED_OUTPUT_MISSING)
          : check.blockers || []),
        ...((existing.blockers || []).filter((blocker) => blocker === productionBlockers.QC_REJECTED)),
      ]),
      note: existing.note || null,
      ...(existing.createdAt ? { createdAt: existing.createdAt } : {}),
    };
  });
}

function aggregateStatus(fileChecks = [], extraBlockers = [], options = {}) {
  const hard = hardBlockers(fileChecks, extraBlockers);
  if (hard.length > 0) {
    return {
      status: productionTaskStatuses.BLOCKED,
      scaleStatus: productionScaleStatuses.NEED_SCALE,
      qcStatus: productionQcStatuses.NOT_READY,
      blockers: unique([...hard, ...fileChecks.flatMap((check) => check.blockers || [])]),
    };
  }

  const requiredChecks = fileChecks.filter(requiresScaledOutput);
  const manualScaledChecks = fileChecks.filter((check) => (
    !check.required
    && check.sourceType === productionSourceTypes.CUSTOMER_IMAGE
    && check.outputAssetId
  ));
  if (!requiredChecks.length) {
    if (manualScaledChecks.length) {
      if (!options.submitQc && !manualScaledChecks.some((check) => check.qcStatus === productionQcStatuses.PENDING)) {
        return {
          status: productionTaskStatuses.NEED_SCALE,
          scaleStatus: productionScaleStatuses.SCALED,
          qcStatus: productionQcStatuses.NOT_READY,
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

  const submittedForQc = options.submitQc
    || requiredChecks.some((check) => check.qcStatus === productionQcStatuses.PENDING);
  if (!submittedForQc) {
    return {
      status: productionTaskStatuses.NEED_SCALE,
      scaleStatus: productionScaleStatuses.SCALED,
      qcStatus: productionQcStatuses.NOT_READY,
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
  if ((mode === 'upload' || mode === 'submitQc') && aggregate.status === productionTaskStatuses.QC_PENDING) {
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
      .filter((organization) => /^DES(?:IGN)?$/i.test(String(organization.team?.code || '')))
      .map((organization) => toId(organization.accountId)),
  );

  return profiles.filter((profile) => designTeamAccountIds.has(toId(profile.accountId)));
}

async function transitionOrderItemStatus(orderItemId, targetStatus, session) {
  const context = { source: 'PRODUCTION' };
  if (session) context.session = session;
  return orderPublic.transitionItemStatus(orderItemId, targetStatus, context);
}

function toCustomizationSnapshot(customization) {
  if (!customization) return null;
  return {
    payloadId: customization.payloadId || null,
    status: customization.status || null,
    needsReview: Boolean(customization.needsReview),
    listingPreviewImageUrl: customization.listingPreviewImageUrl || null,
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

function toVendorProductSnapshot(product) {
  if (!product) return null;
  return {
    id: toId(product),
    code: product.code || null,
    name: product.name || null,
    vendor: toRefSnapshot(product.vendor || product.vendorId),
    baseCostAmount: product.baseCostAmount ?? null,
    currency: product.currency || null,
  };
}

function toVendorCostCenterSnapshot(costCenter) {
  if (!costCenter) return null;
  return {
    id: toId(costCenter),
    vendorProductId: toId(costCenter.vendorProductId),
    code: costCenter.code || null,
    name: costCenter.name || null,
    sku: costCenter.sku || null,
    lngCode: costCenter.lngCode || null,
    standardSize: costCenter.standardSize || null,
    standardColor: costCenter.standardColor || null,
    printMethod: costCenter.printMethod || null,
    baseCostAmount: costCenter.baseCostAmount ?? null,
    currency: costCenter.currency || null,
  };
}

function toListingSnapshot(listing) {
  if (!listing) return null;
  return {
    id: toId(listing),
    sku: listing.sku || null,
    asin: listing.asin || null,
    title: listing.title || null,
    printMethod: listing.printMethod || null,
    productImageUrl: listing.productImageUrl || listing.thumbnailUrl || listing.thumbnailAsset?.secureUrl || null,
    scaleDifficulty: listing.scaleDifficulty || null,
  };
}

function orderCaseBlockers(order = {}) {
  return String(order?.caseStatus || '').toUpperCase() === 'OPEN'
    ? [productionBlockers.OPEN_CASE]
    : [];
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

function productImageUrlFrom(item = {}, listing = {}, customization = {}) {
  return listing?.productImageUrl
    || listing?.thumbnailUrl
    || listing?.thumbnailAsset?.secureUrl
    || item.productImageUrl
    || item.imageUrl
    || item.externalData?.productImageUrl
    || item.externalData?.imageUrl
    || customization?.listingPreviewImageUrl
    || null;
}

function taskProductImageUrl(task = {}) {
  return task.listingSnapshot?.productImageUrl
    || task.orderItemSnapshot?.productImageUrl
    || task.customizationSnapshot?.listingPreviewImageUrl
    || null;
}

function snapshotPayload({ item, order, plan, listing, template, customization, fileChecks, aggregate }) {
  return {
    orderId: item.orderId,
    shopId: item.shopId,
    orderItemId: item._id || item.id,
    fulfillmentPlanId: plan.id,
    listingVariantId: plan.listingVariantId || null,
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
      productImageUrl: productImageUrlFrom(item, listing, customization),
    },
    listingSnapshot: toListingSnapshot(listing || plan.listing),
    templateSnapshot: toTemplateSnapshot(template || plan.internalTemplate),
    vendorProductSnapshot: toVendorProductSnapshot(plan.vendorProduct),
    vendorCostCenterSnapshot: toVendorCostCenterSnapshot(plan.vendorCostCenter),
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

async function appendProductionTimeline({ item, eventType, authContext, session, metadata = {} }) {
  const payload = {
    orderId: item.orderId,
    orderItemId: item._id || item.id,
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    eventType,
    source: 'PRODUCTION',
    actorId: authContext?.accountId || null,
    metadata,
  };
  await (session ? orderPublic.appendTimeline(payload, { session }) : orderPublic.appendTimeline(payload));
}

async function appendTaskTimeline(task, eventType, authContext, session) {
  const item = session
    ? await orderPublic.findItemById(task.orderItemId, { session })
    : await orderPublic.findItemById(task.orderItemId);
  if (!item) throw notFound('Order item not found');
  await appendProductionTimeline({ item, eventType, authContext, session });
}

async function commitProductionMutation({
  task, filter, patch, eventType, action, authContext, changes = null, metadata = {}, targetItemStatus = null,
}) {
  return withProductionOperation(async (session) => {
    const updated = await repository.updateByIdIf(toId(task), filter, patch, { session });
    if (!updated) throw conflict('Production task changed concurrently');
    if (targetItemStatus) await transitionOrderItemStatus(task.orderItemId, targetItemStatus, session);
    await appendTaskTimeline(task, eventType, authContext, session);
    await recordProductionOperation({ action, task, authContext, changes, metadata, session });
    return updated;
  });
}

async function triggerVendorSubmissionForReadyTask(taskId, authContext) {
  try {
    // ponytail: inline V1 trigger; move to a queue when retries/throughput matter.
    const vendorSubmissionPublic = require('../../vendorSubmission/public');
    const fulfillmentSubmission = await vendorSubmissionPublic.createAndSubmitFulfillmentOrderFromProductionTask?.(taskId, {
      ...(authContext || {}),
      system: true,
      source: 'PRODUCTION',
    });
    if (fulfillmentSubmission) return;
    if (typeof vendorSubmissionPublic.createAndSubmitFromProductionTask === 'function') {
      await vendorSubmissionPublic.createAndSubmitFromProductionTask(taskId, {
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

async function attachListingVariantScaleDifficulties(tasks = []) {
  const variantIds = unique(tasks.map((task) => toId(task?.listingVariantId)).filter(Boolean));
  if (!variantIds.length) return tasks;
  const cachedDifficulties = variantIds.map((variantId) => readListEnrichmentCache(
    variantDifficultyEnrichmentCache,
    variantId,
  ));
  const missingVariantIds = variantIds.filter((variantId, index) => cachedDifficulties[index] === undefined);
  const variants = missingVariantIds.length
    ? await catalogPublic.listListingVariantScaleDifficultiesByIds(missingVariantIds)
    : [];
  (variants || []).forEach((variant) => {
    writeListEnrichmentCache(
      variantDifficultyEnrichmentCache,
      toId(variant),
      variant.scaleDifficulty || null,
    );
  });
  missingVariantIds.forEach((variantId) => {
    if (readListEnrichmentCache(variantDifficultyEnrichmentCache, variantId) === undefined) {
      writeListEnrichmentCache(variantDifficultyEnrichmentCache, variantId, null);
    }
  });
  const byId = new Map((variants || []).map((variant) => [toId(variant), variant.scaleDifficulty || null]));
  variantIds.forEach((variantId, index) => {
    if (cachedDifficulties[index] !== undefined) byId.set(variantId, cachedDifficulties[index]);
  });
  return tasks.map((task) => {
    const scaleDifficulty = byId.get(toId(task?.listingVariantId));
    if (!scaleDifficulty) return task;
    return {
      ...task,
      listingSnapshot: {
        ...(task.listingSnapshot || {}),
        scaleDifficulty,
      },
    };
  });
}

async function assertScaleAddressReady(task) {
  const order = await orderPublic.findById(task.orderId);
  const addressValidationStatus = order?.addressValidationStatus || addressValidationStatuses.NOT_CHECKED;

  if (!SCALE_READY_ADDRESS_STATUSES.has(addressValidationStatus)) {
    throw conflict('Order address must be valid before scale', { addressValidationStatus });
  }
}

async function syncOrderAddressSnapshot(order) {
  if (!order?._id && !order?.id) return;
  await repository.updateOrderAddressSnapshot(toId(order._id || order.id), order);
}

function getVendorSubmissionPublic() {
  return require('../../vendorSubmission/public');
}

async function prepareForMappingOverride(orderItemId, authContext = {}) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const task = await repository.findByOrderItem(orderItemId);
  if (!task) return { allowed: true, productionTaskId: null };
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);

  const taskId = toId(task);
  if (task.status === productionTaskStatuses.SENT_TO_VENDOR) {
    throw conflict('Production task already sent to vendor', {
      productionTaskId: taskId,
      status: task.status,
    });
  }

  const vendorSubmissionPublic = getVendorSubmissionPublic();
  const submission = typeof vendorSubmissionPublic.getByProductionTaskId === 'function'
    ? await vendorSubmissionPublic.getByProductionTaskId(taskId)
    : null;
  if (submission?.status === 'SUBMITTED') {
    throw conflict('Submitted vendor submission cannot be remapped', {
      productionTaskId: taskId,
      vendorSubmissionId: submission.id,
      vendorSubmissionStatus: submission.status,
    });
  }

  if (submission && submission.status !== 'CANCELLED' && typeof vendorSubmissionPublic.cancel === 'function') {
    await vendorSubmissionPublic.cancel(submission.id, {
      cancelReason: 'Cancelled before manual vendor rematch',
    }, {
      ...(authContext || {}),
      system: true,
      source: 'MAPPING_OVERRIDE',
    });
  }

  if (submission || task.vendorSubmissionId || task.sentToVendorAt) {
    await repository.updateById(taskId, {
      vendorSubmissionId: null,
      sentToVendorAt: null,
    });
  }

  return {
    allowed: true,
    productionTaskId: taskId,
    productionStatus: task.status,
    cancelledVendorSubmissionId: submission && submission.status !== 'CANCELLED' ? submission.id : null,
  };
}

async function createOrRecheckTaskForOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  assertCanAccessShop(item.shopId, productionPermissions.WRITE, authContext);
  await orderPublic.assertMarketplaceAllowsFulfillment(item.orderId, orderItemId);
  const order = item.orderId ? await orderPublic.findById(item.orderId) : null;

  const plan = await loadReadyPlan(orderItemId, authContext);
  const listingId = plan.listing?.id || plan.listingId || item.listingId || null;
  const baseListing = listingId ? await catalogPublic.getListingById(listingId) : null;
  const variant = plan.listingVariantId && typeof catalogPublic.getListingVariantById === 'function'
    ? await catalogPublic.getListingVariantById(plan.listingVariantId)
    : null;
  if (plan.listingVariantId && (
    !variant
    || String(variant.listingId) !== String(listingId || '')
  )) {
    throw conflict('Listing variant from fulfillment plan is unavailable', {
      blockingReasons: ['LISTING_VARIANT_NOT_FOUND'],
      listingVariantId: plan.listingVariantId,
    });
  }
  const listing = variant ? {
    ...baseListing,
    productTypeGroupId: variant.productTypeGroup || null,
    internalTemplateId: variant.internalTemplate || null,
    psdTemplateAssetId: variant.psdTemplateAssetId || null,
    previewAssetId: variant.previewAssetId || null,
    previewAsset: variant.previewAsset || null,
    psdReadiness: variant.psdReadiness || null,
    scaleDifficulty: variant.scaleDifficulty || null,
    printMethod: variant.printMethod || variant.productTypeGroup?.printMethod || plan.listing?.printMethod || null,
  } : baseListing;
  const templateId = variant?.internalTemplate?.id
    || plan.internalTemplate?.id;
  const template = templateId ? await catalogPublic.getInternalTemplateById(templateId) : null;
  const psdReadiness = variant?.psdReadiness || null;
  const customization = await customizationPublic.getOrderItemCustomizationView(orderItemId, authContext);
  const derivedFileChecks = buildFileChecks({
    listing: listing ? { ...listing, psdReadiness } : listing,
    template,
    customization,
  });
  const operation = await withProductionOperation(async (session) => {
    const current = await repository.findByOrderItem(orderItemId, { session });
    const fileChecks = preserveExistingScaledOutputs(derivedFileChecks, current?.fileChecks);
    const aggregate = aggregateStatus(fileChecks, orderCaseBlockers(order));
    const {
      fileChecks: initialFileChecks,
      status: initialStatus,
      scaleStatus: initialScaleStatus,
      qcStatus: initialQcStatus,
      blockers: initialBlockers,
      ...readinessSnapshots
    } = snapshotPayload({ item, order, plan, listing, template, customization, fileChecks, aggregate });
    if (current?.designTypeSource !== 'MANUAL') {
      // Extracted ZIP previews are not evidence of a buyer-uploaded image.
      const buyerImages = customerImageInputs(customization).filter((image) => (
        !normalizedInputKeys(image).some((key) => genericImageInputKeys.has(key))
      ));
      readinessSnapshots.designType = buyerImages.length
        ? 'CUSTOM_IMAGE'
        : customization?.status === 'PARSED' && !customization.needsReview
          && Array.isArray(customization.customerInputs?.images)
          && (customization.customerInputs.texts?.length || customization.customerInputs.options?.length)
          ? 'NORMAL' : null;
      readinessSnapshots.designTypeSource = 'AUTO';
    }
    let result;
    if (current) {
      const terminal = RECHECK_TERMINAL_STATUSES.has(current.status);
      const task = await repository.updateByIdIf(
        toId(current),
        current.updatedAt ? { updatedAt: current.updatedAt } : {},
        terminal ? readinessSnapshots : {
          ...readinessSnapshots,
          fileChecks: initialFileChecks,
          status: initialStatus,
          scaleStatus: initialScaleStatus,
          qcStatus: initialQcStatus,
          blockers: initialBlockers,
          readyAt: initialStatus === productionTaskStatuses.READY_TO_SEND_VENDOR
            ? current.readyAt || new Date()
            : null,
        },
        { session },
      );
      if (!task) throw conflict('Production task changed concurrently');
      result = { task, created: false };
    } else {
      result = await repository.upsertByOrderItemWithResult(orderItemId, readinessSnapshots, {
        session,
        setOnInsert: {
          fileChecks: initialFileChecks,
          status: initialStatus,
          scaleStatus: initialScaleStatus,
          qcStatus: initialQcStatus,
          blockers: initialBlockers,
          assignedDesignUserId: null,
          assignedAt: null,
          designNote: null,
          csAssigneeId: null,
          csAssignedBy: null,
          csAssignedAt: null,
          csStatus: productionCsStatuses.UNASSIGNED,
          csNote: item.csNote ?? null,
          qcBy: null,
          qcAt: null,
          readyAt: initialStatus === productionTaskStatuses.READY_TO_SEND_VENDOR ? new Date() : null,
          sentToVendorAt: null,
          vendorSubmissionId: null,
        },
      });
    }
    const task = result.task;
    if (result.created || !RECHECK_TERMINAL_STATUSES.has(task.status)) {
      await transitionOrderItemStatus(orderItemId, orderItemStatusForProductionAggregate(task), session);
    }
    if (result.created) {
      await appendProductionTimeline({
        item,
        eventType: 'PRODUCTION_TASK_CREATED',
        authContext,
        session,
        metadata: { blockers: task.blockers || [] },
      });
    }
    await recordProductionOperation({
      action: result.created ? 'PRODUCTION_TASK_CREATED' : 'PRODUCTION_TASK_RECHECKED',
      task, authContext, session,
      changes: { status: { from: current?.status || null, to: task.status || null } },
      metadata: { blockerCount: (task.blockers || []).length },
    });
    return { ...result, previousStatus: current?.status || null };
  });
  const task = operation.task;
  if (
    !operation.created
    && operation.previousStatus !== productionTaskStatuses.BLOCKED
    && task.status === productionTaskStatuses.BLOCKED
  ) {
    await notifyAssignedDesigner(task, {
      type: 'PRODUCTION_BLOCKED',
      title: 'Production task blocked',
      message: 'Your production task is blocked and needs attention.',
      version: task.updatedAt,
    });
  }
  const [enrichedTask] = await attachVendorSubmissions(await attachProductionUsers(await attachShops([task])));
  return toProductionTaskDto(enrichedTask);
}

async function getTaskByOrderItem(orderItemId, authContext) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  const sellerIds = await orderPublic.personalSellerItemIds?.(authContext, productionPermissions.READ);
  if (sellerIds !== undefined) {
    if (!sellerIds.map(String).includes(String(orderItemId))) throw forbidden();
  } else assertCanAccessShop(item.shopId, productionPermissions.READ, authContext);
  const [task] = await attachVendorSubmissions(await attachProductionUsers(await attachShops([
    ...(await attachOrderSnapshots([
      await attachCustomizationSnapshot(await repository.findByOrderItem(orderItemId), authContext),
    ])),
  ])));
  return toProductionTaskDto(task);
}

async function listPsdBlockedTasksByListing(listingId) {
  assertValidObjectId(listingId, 'listingId');
  const tasks = await findPsdBlockedTasksByListing(listingId);
  return (tasks || []).map((task) => ({
    id: toId(task),
    orderItemId: toId(task.orderItemId),
    externalOrderId: task.orderItemSnapshot?.externalOrderId || null,
    listingId: toId(task.listingSnapshot?.id || task.listingSnapshot?._id) || String(listingId),
    productImageUrl: taskProductImageUrl(task),
    shopId: toId(task.shopId),
    blockers: task.blockers || [],
  }));
}

async function findPsdBlockedTasksByListing(listingId) {
  const [tasksBySnapshot, orderItemIds] = await Promise.all([
    repository.listPsdBlockedByListingId(listingId),
    orderPublic.findItemIds({ listingId }),
  ]);
  const tasksByOrderItem = await repository.listPsdBlockedByOrderItemIds(orderItemIds || []);
  return [...new Map(
    [...(tasksBySnapshot || []), ...(tasksByOrderItem || [])]
      .map((task) => [toId(task), task]),
  ).values()];
}

async function listPsdBlockedTasksByExternalOrderId(externalOrderId) {
  const tasks = await repository.listPsdBlockedByExternalOrderId(externalOrderId);
  return (tasks || []).map((task) => ({
    id: toId(task),
    orderItemId: toId(task.orderItemId),
    externalOrderId: task.orderItemSnapshot?.externalOrderId || null,
    listingId: toId(task.listingSnapshot?.id || task.listingSnapshot?._id),
    productImageUrl: taskProductImageUrl(task),
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
  const orderIds = unique(missing.map((task) => toId(task.orderId)));
  const orders = typeof orderPublic.findOrdersByIds === 'function'
    ? await orderPublic.findOrdersByIds(orderIds)
    : await Promise.all(orderIds.map((orderId) => orderPublic.findById(orderId)));
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
        await createOrRecheckTaskForOrderItem(toId(task.orderItemId), {
          ...authContext,
          system: true,
        }),
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
  const tasks = await findPsdBlockedTasksByListing(listingId);
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
  const scopedQuery = await readScopeForTask(task, authContext);
  const canReadCompletedTask = !scopedQuery?.sellerOrderItemIds && hasAnyGlobalPermission(authContext, [
    productionPermissions.SCALE_ASSIGN,
    productionPermissions.QC_REVIEW,
  ]) && [
    productionTaskStatuses.READY_TO_SEND_VENDOR,
    productionTaskStatuses.SENT_TO_VENDOR,
  ].includes(task.status);
  if ((!scopedQuery || !taskMatchesScopedReadQuery(task, scopedQuery)) && !canReadCompletedTask) throw forbidden();
  const [enrichedTask] = await attachVendorSubmissions(await attachProductionUsers(await attachShops([
    ...(await attachOrderSnapshots([
      await attachCustomizationSnapshot(task, authContext),
    ])),
  ])));
  return toProductionTaskDto(enrichedTask);
}

async function getTasksByOrderId(orderId, authContext) {
  const tasks = await repository.listByOrderId(orderId);
  if (!tasks.length) return [];
  if (!authContext?.system) {
    await Promise.all(tasks.map((task) => assertCanAccessShop(task.shopId, productionPermissions.READ, authContext)));
  }
  return tasks;
}

function taskMatchesScopedReadQuery(task = {}, query = {}) {
  if (query.sellerOrderItemIds && !query.sellerOrderItemIds.map(String).includes(toId(task.orderItemId))) return false;
  if (query.qcTeamAccountIds) {
    const contributors = [task.assignedDesignUserId, task.csAssigneeId,
      ...(task.fileChecks || []).map((check) => check.outputWorkerId)].map(toId).filter(Boolean);
    const canReadQc = contributors.some((id) => query.qcTeamAccountIds.map(String).includes(id))
      || (query.qcReadShopIds || []).map(String).includes(toId(task.shopId));
    const isNonQc = ![productionQcStatuses.PENDING, productionQcStatuses.PASSED, productionQcStatuses.REJECTED]
      .includes(task.qcStatus);
    if (!canReadQc && !(query.allowNonQcTasks && isNonQc)) return false;
  }
  if (query.shopId && toId(task.shopId) !== String(query.shopId)) return false;
  if (query.shopIds?.length && !query.shopIds.map(String).includes(toId(task.shopId))) return false;
  if (
    Object.prototype.hasOwnProperty.call(query, 'assignedDesignUserId')
    && toId(task.assignedDesignUserId) !== String(query.assignedDesignUserId)
  ) return false;
  if (
    query.assignedDesignUserIds?.length
    && !query.assignedDesignUserIds.map(String).includes(toId(task.assignedDesignUserId))
    && !(query.includeUnassignedDesignUser && !toId(task.assignedDesignUserId))
  ) return false;
  if (
    Object.prototype.hasOwnProperty.call(query, 'csAssigneeId')
    && toId(task.csAssigneeId) !== String(query.csAssigneeId)
  ) return false;
  if (
    query.scaleQueueOnly
    && ![productionTaskStatuses.NEED_SCALE, productionTaskStatuses.QC_REJECTED].includes(task.status)
  ) return false;
  if (query.qcQueueOnly && task.qcStatus !== productionQcStatuses.PENDING) return false;
  return true;
}

async function canReadTaskById(taskId, authContext = {}) {
  try {
    const task = await loadTask(taskId);
    const scopedQuery = await readScopeForTask(task, authContext);
    return Boolean(scopedQuery && taskMatchesScopedReadQuery(task, scopedQuery));
  } catch (error) {
    if (error?.statusCode === httpStatus.NOT_FOUND || error?.statusCode === httpStatus.FORBIDDEN) return false;
    throw error;
  }
}

async function canReadAssignedTaskInputAsset(assetId, authContext = {}) {
  if (!assetId || !isAssignedDesigner({ assignedDesignUserId: authContext.accountId }, authContext)) return false;
  return Boolean(await repository.findAssignedTaskReferencingInputAsset(assetId, authContext.accountId));
}

async function readScopeForTask(task, authContext) {
  const query = await applyReadScope({}, authContext);
  if (query?.sellerOrderItemIds) return query;
  if (query && taskMatchesScopedReadQuery(task, query)) return query;
  if ([productionQcStatuses.PENDING, productionQcStatuses.PASSED, productionQcStatuses.REJECTED].includes(task.qcStatus)) {
    return applyReadScope({ view: 'QC' }, authContext);
  }
  return null;
}

function normalizeListQuery(query = {}) {
  const result = {};
  if (query.designType) result.designType = String(query.designType).trim().toUpperCase();
  if (query.status) result.status = String(query.status).trim().toUpperCase();
  if (query.scaleStatus) result.scaleStatus = String(query.scaleStatus).trim().toUpperCase();
  if (query.qcStatus) result.qcStatus = String(query.qcStatus).trim().toUpperCase();
  if (query.salesChannelCode) result.salesChannelCode = String(query.salesChannelCode).trim().toUpperCase();
  if (query.psdReadyOnly === true || query.psdReadyOnly === 'true') result.psdReadyOnly = true;
  if (query.readyForScale === true || query.readyForScale === 'true') result.readyForScale = true;
  if (query.scaleDifficultyLevel) {
    result.scaleDifficultyLevel = String(query.scaleDifficultyLevel).trim().toUpperCase();
  }
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
  if (['SCALE', 'QC'].includes(query.view)) result.view = query.view;
  return result;
}

async function withVariantScaleDifficultyFilter(query = {}) {
  if (!query.scaleDifficultyLevel) return query;
  const listingVariantIds = await catalogPublic.listListingVariantIdsByScaleDifficulty(query.scaleDifficultyLevel);
  return { ...query, listingVariantIds };
}

async function currentScaleDifficultyLevel(task = {}) {
  try {
    if (task.listingVariantId && typeof catalogPublic.getListingVariantById === 'function') {
      const variant = await catalogPublic.getListingVariantById(task.listingVariantId);
      return variant?.scaleDifficulty?.level || task.listingSnapshot?.scaleDifficulty?.level || 'NORMAL';
    }
  } catch (error) {
    logger.warn('Production score scale difficulty lookup skipped', {
      productionTaskId: toId(task),
      listingVariantId: toId(task.listingVariantId),
      error,
    });
  }
  return task.listingSnapshot?.scaleDifficulty?.level || 'NORMAL';
}

async function listTasks(query = {}, authContext) {
  const startedAt = Date.now();
  const normalizedQuery = await withVariantScaleDifficultyFilter(normalizeListQuery(query));
  const scopedQuery = await applyReadScope(normalizedQuery, authContext);
  if (!scopedQuery) return emptyTaskList(normalizedQuery);
  const result = await repository.list(scopedQuery);
  const baseItems = await attachOrderSnapshots(await attachCustomizationSnapshots(result.items, authContext));
  const [
    shopItems,
    userItems,
    difficultyItems,
    vendorItems,
  ] = await Promise.all([
    attachShops(baseItems),
    attachProductionUsers(baseItems),
    attachListingVariantScaleDifficulties(baseItems),
    query.view === 'QC' ? Promise.resolve(baseItems) : attachVendorSubmissions(baseItems),
  ]);
  const items = baseItems.map((item, index) => ({
    ...item,
    shop: shopItems[index]?.shop ?? item.shop ?? null,
    scaleByUser: userItems[index]?.scaleByUser ?? item.scaleByUser ?? null,
    qcByUser: userItems[index]?.qcByUser ?? item.qcByUser ?? null,
    csAssigneeUser: userItems[index]?.csAssigneeUser ?? item.csAssigneeUser ?? null,
    orderOwnerUser: userItems[index]?.orderOwnerUser ?? item.orderOwnerUser ?? null,
    sellerUser: userItems[index]?.sellerUser ?? item.sellerUser ?? null,
    listingSnapshot: difficultyItems[index]?.listingSnapshot || item.listingSnapshot,
    ...(query.view === 'QC' ? {} : { vendorSubmission: vendorItems[index]?.vendorSubmission || null }),
  }));
  const response = {
    items: query.view === 'QC'
      ? items.map(toQcTaskSummaryDto)
      : items.map(toProductionTaskSummaryDto),
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
  const normalizedQuery = await withVariantScaleDifficultyFilter(normalizeListQuery(query));
  const scopedQuery = await applyReadScope(normalizedQuery, authContext);
  if (!scopedQuery) return emptyTaskSummary();
  const summary = await repository.summarize(scopedQuery);
  warnIfProductionQueueSlow(startedAt, {
    route: 'GET /api/production/tasks/summary',
    resultCount: summary.total,
    filters: scopedQuery,
  });
  return summary;
}

async function summarizeQueueCounts(query = {}, authContext) {
  const normalizedQuery = normalizeListQuery(query);
  const scopedQuery = await applyReadScope({
    ...(normalizedQuery.search ? { search: normalizedQuery.search } : {}),
    ...(normalizedQuery.salesChannelCode ? { salesChannelCode: normalizedQuery.salesChannelCode } : {}),
    ...(normalizedQuery.shopId ? { shopId: normalizedQuery.shopId } : {}),
  }, authContext);
  const counts = scopedQuery ? await repository.summarizeQueueCounts(scopedQuery) : emptyQueueCounts();
  if (hasAnyTeamScopedPermission(authContext, [DESIGN_REVIEW_PERMISSION])
    || (hasAnyPermission(authContext, [productionPermissions.SCALE_ASSIGN])
      && hasAnyPermission(authContext, [productionPermissions.QC_REVIEW]))) {
    const qcQuery = await applyReadScope({
      view: 'QC',
      ...(normalizedQuery.search ? { search: normalizedQuery.search } : {}),
      ...(normalizedQuery.salesChannelCode ? { salesChannelCode: normalizedQuery.salesChannelCode } : {}),
      ...(normalizedQuery.shopId ? { shopId: normalizedQuery.shopId } : {}),
    }, authContext);
    const qcCounts = qcQuery ? await repository.summarizeQueueCounts(qcQuery) : emptyQueueCounts();
    return { ...counts, qcQueue: qcCounts.qcQueue };
  }
  return counts;
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
  assertCanScaleTask(task, authContext);
  assertScaleMutationAllowed(task);

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

  const fileCheck = {
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
  };
  const updated = await withProductionOperation(async (session) => {
    const appended = await repository.appendFileCheckIfMutable(taskId, fileCheck, {
      session,
      ...(isAssignedDesigner(task, authContext) ? { assignedDesignUserId: authContext.accountId } : {}),
    });
    if (!appended) throw conflict('Production file check changed concurrently');
    const aggregate = aggregateStatus(appended.fileChecks || []);
    await repository.updateById(taskId, aggregate, { session });
    const result = { ...appended, ...aggregate };
    await transitionOrderItemStatus(task.orderItemId, orderItemStatusForProductionAggregate(aggregate, 'manual'), session);
    await appendTaskTimeline(task, 'PRODUCTION_MANUAL_FILE_CHECK_ADDED', authContext, session);
    await recordProductionOperation({
      action: 'PRODUCTION_FILE_CHECK_ADDED', task, authContext, session,
      metadata: { slotKey, inputAssetPresent: Boolean(inputAssetId) },
    });
    return result;
  });
  return toProductionTaskDto(updated);
}

async function uploadScaledFileForTask(task, fileCheckId, mediaAssetId, authContext) {
  assertScaleMutationAllowed(task);
  await mediaPublic.assertMediaAssetExists(mediaAssetId);
  const current = findCheck(task, fileCheckId);
  const checkPatch = {
    outputAssetId: mediaAssetId,
    outputWorkerId: authContext.accountId || null,
    scaleStatus: productionScaleStatuses.SCALED,
    qcStatus: productionQcStatuses.NOT_READY,
    blockers: (current.blockers || []).filter((blocker) => ![
      productionBlockers.SCALED_OUTPUT_MISSING,
      productionBlockers.CUSTOMER_IMAGE_MISSING,
      productionBlockers.QC_REJECTED,
    ].includes(blocker)),
  };
  const expected = {
    outputAssetId: current.outputAssetId || null,
    scaleStatus: current.scaleStatus,
    qcStatus: current.qcStatus,
    blockers: current.blockers || [],
  };
  const updated = await withProductionOperation(async (session) => {
    const changed = await repository.updateFileCheckOutputIfMutable(
      toId(task), fileCheckId, expected, checkPatch, {
        session,
        ...(isAssignedDesigner(task, authContext) ? { assignedDesignUserId: authContext.accountId } : {}),
      },
    );
    if (!changed) throw conflict('Scaled output changed concurrently');
    const aggregate = aggregateStatus(changed.fileChecks || []);
    await repository.updateById(toId(task), aggregate, { session });
    const result = { ...changed, ...aggregate };
    await transitionOrderItemStatus(
      task.orderItemId, orderItemStatusForProductionAggregate(aggregate, 'upload'), session,
    );
    await appendTaskTimeline(task, 'PRODUCTION_SCALED_FILE_UPLOADED', authContext, session);
    await recordProductionOperation({
      action: 'PRODUCTION_SCALED_FILE_UPLOADED', task, authContext, session,
      metadata: { fileCheckId, outputAssetId: mediaAssetId },
    });
    return result;
  });
  return toProductionTaskDto(updated);
}

async function uploadScaledFile(taskId, fileCheckId, mediaAssetId, authContext) {
  assertValidObjectId(mediaAssetId, 'mediaAssetId');
  const task = await loadTask(taskId);
  assertCanScaleTask(task, authContext);
  await assertScaleAddressReady(task);
  return uploadScaledFileForTask(task, fileCheckId, mediaAssetId, authContext);
}

async function submitScaleForQc(taskId, authContext = {}) {
  const task = await loadTask(taskId);
  assertCanScaleTask(task, authContext);
  await assertScaleAddressReady(task);
  assertScaleMutationAllowed(task);
  const submittableChecks = (task.fileChecks || []).filter((check) => requiresScaledOutput(check) || check.outputAssetId);
  if (!submittableChecks.length || submittableChecks.some((check) => requiresScaledOutput(check) && !check.outputAssetId)) {
    throw conflict('All required scaled outputs must be uploaded before QC submit', {
      blockingReasons: [productionBlockers.SCALED_OUTPUT_MISSING],
    });
  }
  const fileChecks = (task.fileChecks || []).map((check) => (
    requiresScaledOutput(check) || check.outputAssetId
      ? { ...check, qcStatus: productionQcStatuses.PENDING }
      : check
  ));
  const aggregate = aggregateStatus(fileChecks, [], { submitQc: true });
  const updated = await commitProductionMutation({
    task,
    filter: { status: task.status, qcStatus: task.qcStatus, fileChecks: task.fileChecks || [],
      ...(isAssignedDesigner(task, authContext) ? { assignedDesignUserId: authContext.accountId } : {}),
    },
    patch: { ...aggregate, fileChecks },
    eventType: 'PRODUCTION_SCALE_SUBMITTED_QC',
    action: 'PRODUCTION_SCALE_SUBMITTED_QC',
    authContext,
    targetItemStatus: orderItemStatusForProductionAggregate(aggregate, 'submitQc'),
  });
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

  let mediaAsset = null;
  const uploadMetadata = {
    source: 'PRODUCTION_SCALED_OUTPUT',
    taskId,
    fileCheckId,
    uploadedBy: authContext?.accountId || null,
  };

  try {
    assertScaledOutputStorageProvider();
    const task = await loadTask(taskId);
    assertCanScaleTask(task, authContext);
    assertScaleMutationAllowed(task);
    await assertScaleAddressReady(task);
    mediaAsset = await mediaPublic.storeAsset({
      stream: fs.createReadStream(file.path),
      filename: file.originalname,
      mimeType: file.mimetype || null,
      metadata: uploadMetadata,
      shopId: task.shopId,
      ownerType: 'PRODUCTION_TASK',
      ownerId: task._id || task.id,
      maxBytes: file.size || config.media.uploadMaxBytes,
    });
    return await uploadScaledFileForTask(task, fileCheckId, mediaAsset._id || mediaAsset.id, authContext);
  } catch (error) {
    if (mediaAsset) {
      try {
        await mediaPublic.discardUnattachedAsset(
          mediaAsset._id || mediaAsset.id,
          uploadMetadata,
          error?.code === errorCodes.CONFLICT_ERROR
            ? 'QC_PASS_CAS_LOST'
            : 'PRODUCTION_ATTACHMENT_FAILED',
        );
      } catch (cleanupError) {
        logger.warn('Unattached scaled output cleanup failed', {
          assetId: mediaAsset._id || mediaAsset.id,
          taskId,
          fileCheckId,
          error: cleanupError,
        });
      }
    }
    throw error;
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
    assertCanScaleTask(task, authContext);
    assertScaleMutationAllowed(task);
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
  const profiles = await hrPublic.listAssignableProfiles({
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
  await assertCanAssignDesignTask(task, payload.assignedDesignUserId, authContext);
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
  const noteChanged = Object.prototype.hasOwnProperty.call(payload, 'designNote')
    && (task.designNote || null) !== (payload.designNote || null);
  if (toId(task.assignedDesignUserId) === payload.assignedDesignUserId && !noteChanged) return toProductionTaskDto(task);
  const updated = await commitProductionMutation({
    task,
    filter: {
      status: task.status,
      assignedDesignUserId: task.assignedDesignUserId || null,
      ...(Object.prototype.hasOwnProperty.call(patch, 'designNote')
        ? { designNote: task.designNote || null }
        : {}),
    },
    patch, eventType: 'PRODUCTION_DESIGN_ASSIGNED', action: 'PRODUCTION_DESIGN_ASSIGNED', authContext,
    changes: { assignedDesignUserId: { from: toId(task.assignedDesignUserId), to: payload.assignedDesignUserId } },
    metadata: { noteChanged },
  });
  await notifyAssignedDesigner(updated, {
    type: 'PRODUCTION_ASSIGNED',
    title: 'Production task assigned',
    message: 'You were assigned a production task.',
    version: updated.assignedAt,
  });
  return toProductionTaskDto(updated);
}

async function assignCsTask(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  if (!hasAnyTeamScopedPermission(authContext, [productionPermissions.WRITE, productionPermissions.SCALE_ASSIGN])) {
    assertCanAccessShopAny(task.shopId, [productionPermissions.WRITE, productionPermissions.SCALE_ASSIGN], authContext);
  }
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
    const noteChanged = Object.prototype.hasOwnProperty.call(payload, 'csNote')
      && (task.csNote || null) !== (payload.csNote || null);
    if (!task.csAssigneeId && task.csStatus === productionCsStatuses.UNASSIGNED && !noteChanged) return toProductionTaskDto(task);
    const updated = await commitProductionMutation({
      task,
      filter: {
        csAssigneeId: task.csAssigneeId || null,
        csStatus: task.csStatus,
        ...(Object.prototype.hasOwnProperty.call(patch, 'csNote') ? { csNote: task.csNote || null } : {}),
      },
      patch,
      eventType: 'PRODUCTION_CS_UNASSIGNED', action: 'PRODUCTION_CS_UNASSIGNED', authContext,
      changes: { csAssigneeId: { from: toId(task.csAssigneeId), to: null } }, metadata: { noteChanged },
    });
    return toProductionTaskDto(updated);
  }

  assertValidObjectId(assigneeId, 'csAssigneeId');
  await assertAssignableAccount(
    assigneeId,
    productionPermissions.SCALE_WORK,
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
  const noteChanged = Object.prototype.hasOwnProperty.call(payload, 'csNote')
    && (task.csNote || null) !== (payload.csNote || null);
  if (toId(task.csAssigneeId) === assigneeId && !noteChanged) return toProductionTaskDto(task);
  const updated = await commitProductionMutation({
    task,
    filter: {
      csAssigneeId: task.csAssigneeId || null,
      csStatus: task.csStatus,
      ...(Object.prototype.hasOwnProperty.call(patch, 'csNote') ? { csNote: task.csNote || null } : {}),
    },
    patch,
    eventType: 'PRODUCTION_CS_ASSIGNED', action: 'PRODUCTION_CS_ASSIGNED', authContext,
    changes: { csAssigneeId: { from: toId(task.csAssigneeId), to: assigneeId } }, metadata: { noteChanged },
  });
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
  assertCanAccessShopAny(task.shopId, DESIGN_TASK_WORK_PERMISSIONS, authContext);
  assertDesignAssignable(task);
  if (task.assignedDesignUserId) {
    throw conflict('Production task is already assigned', {
      assignedDesignUserId: toId(task.assignedDesignUserId),
    });
  }
  const updated = await commitProductionMutation({
    task, filter: { assignedDesignUserId: null, status: task.status },
    patch: { assignedDesignUserId: authContext.accountId, assignedAt: new Date() },
    eventType: 'PRODUCTION_DESIGN_CLAIMED', action: 'PRODUCTION_DESIGN_CLAIMED', authContext,
    changes: { assignedDesignUserId: { from: null, to: authContext.accountId } },
  });
  return toProductionTaskDto(updated);
}

async function updateDesignNote(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  const designNote = payload.designNote || null;
  if ((task.designNote || null) === designNote) return toProductionTaskDto(task);
  const updated = await commitProductionMutation({
    task, filter: { designNote: task.designNote || null }, patch: { designNote },
    eventType: 'PRODUCTION_DESIGN_NOTE_UPDATED', action: 'PRODUCTION_DESIGN_NOTE_UPDATED', authContext,
    metadata: { notePresent: Boolean(payload.designNote) },
  });
  return toProductionTaskDto(updated);
}

async function syncCsNoteFromOrderItem(orderItemId, csNote, authContext = {}) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const task = await repository.findByOrderItem(orderItemId);
  if (!task) return null;

  const updated = await repository.updateById(task._id || task.id, {
    csNote: csNote || null,
  });
  await appendTaskTimeline(task, 'PRODUCTION_CS_NOTE_SYNCED', authContext);
  return toProductionTaskDto(updated);
}

async function updateCsNote(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  const csNote = payload.csNote || null;
  if ((task.csNote || null) === csNote) return toProductionTaskDto(task);
  const updated = await commitProductionMutation({
    task, filter: { csNote: task.csNote || null }, patch: { csNote },
    eventType: 'PRODUCTION_CS_NOTE_UPDATED', action: 'PRODUCTION_CS_NOTE_UPDATED', authContext,
    metadata: { notePresent: Boolean(payload.csNote) },
  });
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
  if (task.csStatus === csStatus) return toProductionTaskDto(task);
  const updated = await commitProductionMutation({
    task, filter: { csStatus: task.csStatus }, patch,
    eventType: 'PRODUCTION_CS_STATUS_UPDATED', action: 'PRODUCTION_CS_STATUS_UPDATED', authContext,
    changes: { csStatus: { from: task.csStatus || null, to: csStatus } },
  });
  return toProductionTaskDto(updated);
}

async function submitQc(taskId, payload = {}, authContext) {
  const task = await loadTask(taskId);
  await assertCanReviewTask(task, authContext);
  const reviewerId = toId(authContext?.accountId);
  const outputs = (task.fileChecks || []).filter((check) => check.outputAssetId);
  const isOutputWorker = reviewerId && outputs.some((check) => toId(check.outputWorkerId) === reviewerId);
  const isLegacyAssignee = reviewerId && outputs.some((check) => !check.outputWorkerId)
    && [task.assignedDesignUserId, task.csAssigneeId].some((id) => toId(id) === reviewerId);
  if (isOutputWorker || isLegacyAssignee) throw forbidden('You cannot review your own production output');
  const fileDecisions = Array.isArray(payload.fileDecisions) ? payload.fileDecisions : [];
  const decisionByFileCheckId = new Map(fileDecisions.map((item) => [toId(item.fileCheckId), item]));
  const reviewableChecks = (task.fileChecks || []).filter(
    (check) => requiresScaledOutput(check) || Boolean(check.outputAssetId),
  );
  if (fileDecisions.length) {
    const knownIds = new Set((task.fileChecks || []).map((check) => toId(check)));
    if (decisionByFileCheckId.size !== fileDecisions.length
      || fileDecisions.some((item) => !knownIds.has(toId(item.fileCheckId)))) {
      throw conflict('QC file decisions contain duplicate or unknown file checks');
    }
    if (reviewableChecks.some((check) => !decisionByFileCheckId.has(toId(check)))) {
      throw conflict('QC decision is required for every scaled output');
    }
  }
  const decision = fileDecisions.length
    ? (fileDecisions.some((item) => item.decision === 'REJECTED') ? 'REJECTED' : 'PASSED')
    : String(payload.decision || '').trim().toUpperCase();

  if (decision === 'REJECTED') {
    const now = new Date();
    const fileChecks = (task.fileChecks || []).map((check) => {
      const fileDecision = decisionByFileCheckId.get(toId(check));
      if (fileDecisions.length && !fileDecision) return check;
      const rejected = !fileDecisions.length || fileDecision.decision === 'REJECTED';
      return {
        ...check,
        qcStatus: rejected ? productionQcStatuses.REJECTED : productionQcStatuses.PASSED,
        note: fileDecision?.note || payload.note || check.note || null,
        blockers: rejected
          ? unique([...(check.blockers || []), productionBlockers.QC_REJECTED])
          : (check.blockers || []).filter((blocker) => blocker !== productionBlockers.QC_REJECTED),
      };
    });
    const updated = await commitProductionMutation({
      task, filter: { qcStatus: task.qcStatus || null, fileChecks: task.fileChecks || [],
        assignedDesignUserId: task.assignedDesignUserId || null, csAssigneeId: task.csAssigneeId || null },
      patch: {
        fileChecks,
        status: productionTaskStatuses.QC_REJECTED,
        qcStatus: productionQcStatuses.REJECTED,
        blockers: [productionBlockers.QC_REJECTED],
        qcBy: authContext?.accountId || null,
        qcAt: now,
        readyAt: null,
      },
      eventType: 'PRODUCTION_QC_REJECTED', action: 'PRODUCTION_QC_REJECTED', authContext,
      targetItemStatus: 'QC_REJECTED',
      changes: { qcStatus: { from: task.qcStatus || null, to: productionQcStatuses.REJECTED } },
      metadata: { noteProvided: Boolean(payload.note || fileDecisions.some((item) => item.note)) },
    });
    await notifyAssignedDesigner(updated, {
      type: 'PRODUCTION_QC_REJECTED',
      title: 'Production task failed QC',
      message: 'Your production task failed QC and needs rework.',
      version: updated.updatedAt,
    });
    return toProductionTaskDto(updated);
  }

  if (decision !== 'PASSED') {
    throw conflict('QC decision must be PASSED or REJECTED', { field: 'decision' });
  }

  const requiredChecks = reviewableChecks.filter(requiresScaledOutput);
  if (requiredChecks.some((check) => !check.outputAssetId)) {
    throw conflict('Scaled output is required before QC pass', {
      blockingReasons: [productionBlockers.SCALED_OUTPUT_MISSING],
    });
  }

  const now = new Date();
  const fileChecks = (task.fileChecks || []).map((check) => {
    const fileDecision = decisionByFileCheckId.get(toId(check));
    const passed = fileDecisions.length
      ? fileDecision?.decision === 'PASSED'
      : (check.required || Boolean(check.outputAssetId));
    return {
      ...check,
      qcStatus: passed ? productionQcStatuses.PASSED : check.qcStatus,
      note: fileDecision?.note || check.note || null,
      blockers: (check.blockers || []).filter((blocker) => blocker !== productionBlockers.QC_REJECTED),
    };
  });
  const updated = await commitProductionMutation({
    task, filter: { qcStatus: task.qcStatus || null, fileChecks: task.fileChecks || [],
      assignedDesignUserId: task.assignedDesignUserId || null, csAssigneeId: task.csAssigneeId || null },
    patch: {
      fileChecks,
      status: productionTaskStatuses.READY_TO_SEND_VENDOR,
      scaleStatus: productionScaleStatuses.SCALED,
      qcStatus: productionQcStatuses.PASSED,
      blockers: [],
      qcBy: authContext?.accountId || null,
      qcAt: now,
      readyAt: now,
    },
    eventType: 'PRODUCTION_QC_PASSED', action: 'PRODUCTION_QC_PASSED', authContext,
    targetItemStatus: 'READY_TO_SEND_VENDOR',
    changes: { qcStatus: { from: task.qcStatus || null, to: productionQcStatuses.PASSED } },
  });
  let scoreWarning = null;
  const scaleDifficultyLevel = await currentScaleDifficultyLevel(updated);
  const scoreOutputs = (updated.fileChecks || [])
    .filter(isScoredScaleOutput)
    .map((check) => ({
      fileCheckId: toId(check),
      assetId: toId(check.outputAssetId),
      workerId: toId(check.outputWorkerId) || toId(updated.assignedDesignUserId) || toId(authContext?.accountId),
      contextSnapshot: {
        slotKey: check.slotKey,
        slotLabel: check.slotLabel || null,
        scaleDifficultyLevel,
      },
      scoredAt: now,
    }))
    .filter((output) => output.workerId);
  if (scoreOutputs.length) {
    try {
      await workScorePublic.recordProductionScaleScores({
        productionTaskId: toId(updated),
        shopId: toId(updated.shopId),
        contextSnapshot: {
          orderItemId: toId(updated.orderItemId),
          externalOrderId: updated.orderSnapshot?.externalOrderId || null,
          sku: updated.orderItemSnapshot?.sku || null,
          title: updated.orderItemSnapshot?.title || null,
          productImageUrl: taskProductImageUrl(updated),
          scaleDifficultyLevel,
        },
        outputs: scoreOutputs,
        scoredBy: authContext?.accountId || null,
        scoredAt: now,
      });
    } catch (error) {
      logger.error('production_work_score_creation_failed', { taskId: toId(updated), error });
      scoreWarning = { code: 'SCORE_CREATION_FAILED' };
    }
  }
  await triggerVendorSubmissionForReadyTask(taskId, authContext);
  const dto = toProductionTaskDto(updated);
  if (scoreWarning) dto.warnings = [scoreWarning];
  return dto;
}

async function listWorkScoreCandidates({ limit = 100 } = {}) {
  const tasks = await repository.listQcPassedForWorkScore(limit);
  return Promise.all(tasks.map(async (task) => {
    const scaleDifficultyLevel = await currentScaleDifficultyLevel(task);
    return {
      productionTaskId: toId(task),
      shopId: toId(task.shopId),
      contextSnapshot: {
        orderItemId: toId(task.orderItemId),
        externalOrderId: task.orderSnapshot?.externalOrderId || null,
        sku: task.orderItemSnapshot?.sku || null,
        title: task.orderItemSnapshot?.title || null,
        productImageUrl: taskProductImageUrl(task),
        scaleDifficultyLevel,
      },
      outputs: (task.fileChecks || [])
        .filter(isScoredScaleOutput)
        .map((check) => ({
          fileCheckId: toId(check),
          assetId: toId(check.outputAssetId),
          workerId: toId(check.outputWorkerId) || toId(task.assignedDesignUserId),
          contextSnapshot: {
            slotKey: check.slotKey,
            slotLabel: check.slotLabel || null,
            scaleDifficultyLevel,
          },
          scoredAt: task.qcAt || task.updatedAt,
        }))
        .filter((output) => output.workerId),
    };
  }));
}

async function markSentToVendor(taskId, vendorSubmissionId, authContext) {
  const task = await loadTask(taskId);
  assertCanAccessShop(task.shopId, productionPermissions.WRITE, authContext);
  await orderPublic.assertMarketplaceAllowsFulfillment(task.orderId, task.orderItemId);
  if (
    task.status === productionTaskStatuses.SENT_TO_VENDOR
    && vendorSubmissionId
    && toId(task.vendorSubmissionId) === String(vendorSubmissionId)
  ) {
    return toProductionTaskDto(task);
  }
  if (task.status !== productionTaskStatuses.READY_TO_SEND_VENDOR) {
    throw conflict('Production task is not ready to send vendor', {
      status: task.status,
      vendorSubmissionId: toId(task.vendorSubmissionId),
    });
  }
  if (!vendorSubmissionId) {
    throw conflict('Submitted vendor submission is required');
  }
  const submission = await getVendorSubmissionPublic().getById(vendorSubmissionId, {
    ...(authContext || {}),
    system: true,
  });
  if (submission.status !== 'SUBMITTED' || toId(submission.productionTaskId) !== toId(task)) {
    throw conflict('Vendor submission must be submitted for this production task', {
      productionTaskId: toId(task),
      vendorSubmissionId,
      vendorSubmissionStatus: submission.status || null,
    });
  }
  try {
    const updated = await commitProductionMutation({
      task, filter: { status: productionTaskStatuses.READY_TO_SEND_VENDOR },
      patch: {
        status: productionTaskStatuses.SENT_TO_VENDOR,
        sentToVendorAt: new Date(),
        vendorSubmissionId: vendorSubmissionId || null,
      },
      eventType: 'VENDOR_SUBMISSION_SENT', action: 'PRODUCTION_SENT_TO_VENDOR', authContext,
      targetItemStatus: 'SENT_TO_VENDOR',
      changes: { status: { from: task.status, to: productionTaskStatuses.SENT_TO_VENDOR } },
      metadata: { vendorSubmissionId },
    });
    return toProductionTaskDto(updated);
  } catch (error) {
    const isConcurrentMutation = error?.statusCode === httpStatus.CONFLICT
      && error?.message === 'Production task changed concurrently';
    if (!isConcurrentMutation) throw error;

    const currentTask = await loadTask(taskId);
    if (
      currentTask.status === productionTaskStatuses.SENT_TO_VENDOR
      && toId(currentTask.vendorSubmissionId) === String(vendorSubmissionId)
    ) {
      return toProductionTaskDto(currentTask);
    }
    throw error;
  }
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

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(headers = [], rows = []) {
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\r\n').concat('\r\n');
}

function userLabel(user = null) {
  return user?.fullName || user?.employeeCode || null;
}

async function exportTasksCsv(query = {}, authContext) {
  const result = await listTasks({ ...query, page: 1, limit: query.limit || 5000 }, authContext);
  const headers = [
    'Task ID',
    'Shop',
    'Order ID',
    'Channel',
    'ASIN / Listing ID',
    'SKU',
    'Production Status',
    'Scale Status',
    'QC Status',
    'Blockers',
    'Scale assignee',
    'QC by',
    'Vendor',
    'Vendor product',
    'Cost center',
    'Fulfill qty',
    'Vendor submission',
    'Ready at',
    'Sent to vendor at',
    'Updated at',
  ];
  const rows = (result.items || []).map((task) => [
    task.id,
    task.shopName || task.shop?.name,
    task.orderItem?.externalOrderId,
    task.salesChannelCode || task.orderItem?.salesChannelCode,
    task.orderItem?.asin || task.orderItem?.etsyListingId || task.listing?.asin || task.listing?.etsyListingId,
    task.orderItem?.sku,
    task.productionStatus || task.status,
    task.scaleStatus,
    task.qcStatus,
    (task.blockers || []).join(', '),
    userLabel(task.assignedDesigner),
    userLabel(task.qcUser),
    typeof task.vendorProduct?.vendor === 'object' ? task.vendorProduct.vendor?.name : task.vendorProduct?.vendor,
    task.vendorProduct?.name,
    task.vendorCostCenter?.code || task.vendorCostCenter?.name,
    task.fulfillQty,
    task.vendorSubmission?.status,
    task.readyAt,
    task.sentToVendorAt,
    task.updatedAt,
  ]);

  return {
    filename: `production-tasks-${exportDateStamp()}.csv`,
    contentType: 'text/csv; charset=utf-8',
    content: csvRows(headers, rows),
  };
}

async function exportQcTasksExcel(query = {}, authContext) {
  const normalizedQuery = await withVariantScaleDifficultyFilter(normalizeListQuery(query));
  const scopedQuery = await applyReadScope({ ...normalizedQuery, view: 'QC' }, authContext);
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
  await assertCanReadTasks(tasks, authContext);
  const [withShops, withUsers, withVendorSubmissions] = await Promise.all([
    attachShops(tasks),
    attachProductionUsers(tasks),
    attachVendorSubmissions(tasks),
  ]);
  return tasks.map((task, index) => toProductionTaskSummaryDto({
    ...task,
    shop: withShops[index]?.shop || null,
    scaleByUser: withUsers[index]?.scaleByUser || null,
    qcByUser: withUsers[index]?.qcByUser || null,
    csAssigneeUser: withUsers[index]?.csAssigneeUser || null,
    orderOwnerUser: withUsers[index]?.orderOwnerUser || null,
    sellerUser: withUsers[index]?.sellerUser || null,
    vendorSubmission: withVendorSubmissions[index]?.vendorSubmission || null,
  }));
}

async function listWorkbenchTaskSummariesByOrderItemIds(orderItemIds = [], authContext) {
  const uniqueIds = unique(orderItemIds.map(toId));
  uniqueIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  const tasks = await repository.listSummariesByOrderItemIds(uniqueIds);
  await assertCanReadTasks(tasks, authContext);
  const userIds = unique(tasks.flatMap((task) => [task.assignedDesignUserId, task.qcBy].filter(Boolean).map(toId)));
  const profiles = userIds.length ? await hrPublic.listEmployeeProfilesByAccountIds(userIds) : [];
  const profileById = new Map((profiles || []).map((profile) => [toId(profile.accountId), profile]));
  return tasks.map((task) => toProductionTaskSummaryDto({
    ...task,
    scaleByUser: profileById.get(toId(task.assignedDesignUserId)) || null,
    qcByUser: profileById.get(toId(task.qcBy)) || null,
  }));
}

async function getScaleAssignees(query = {}, authContext) {
  if (!canReadProductionQueue(authContext)) {
    throw forbidden();
  }
  const profiles = await hrPublic.listAssignableProfiles({
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
  if (!canReadProductionQueue(authContext)) {
    throw forbidden();
  }
  const profiles = await hrPublic.listAssignableProfiles({
    search: query.search,
    limit: Math.min(Number(query.limit || 50), 100),
    requiredPermission: productionPermissions.SCALE_WORK,
  });
  return {
    items: (profiles || []).map((profile) => ({
      id: toId(profile.accountId),
      fullName: profile.fullName || null,
      employeeCode: profile.employeeCode || null,
    })),
  };
}

const productionTaskService = {
  addManualFileCheck,
  addManualScaledOutputFile,
  assignCsTask,
  assignDesignTask,
  bulkAssignDesignTasks,
  bulkPushVendor,
  canReadTaskById,
  canReadAssignedTaskInputAsset,
  claimDesignTask,
  createOrRecheckTaskForOrderItem,
  exportTasksCsv,
  exportQcTasksExcel,
  getCsAssignees,
  getTaskById,
  getTasksByOrderId,
  getTaskByOrderItem,
  getScaleAssignees,
  listPsdBlockedTasksByListing,
  listPsdBlockedTasksByExternalOrderId,
  listTasks,
  listWorkScoreCandidates,
  listTaskSummariesByOrderItemIds,
  listWorkbenchTaskSummariesByOrderItemIds,
  markSentToVendor,
  prepareForMappingOverride,
  recheckPsdBlockedTasks,
  recheckPsdBlockedTasksByListing,
  summarizeTasks,
  summarizeQueueCounts,
  submitQc,
  submitScaleForQc,
  updateCsNote,
  updateCsStatus,
  updateDesignNote,
  syncCsNoteFromOrderItem,
  uploadScaledFile,
  uploadScaledOutputFile,
  syncOrderAddressSnapshot,
};

if (process.env.NODE_ENV === 'test') {
  productionTaskService.__clearListEnrichmentCachesForTest = clearListEnrichmentCachesForTest;
}

async function canReadSellerTaskAsset(assetId, authContext) {
  const ids = await orderPublic.personalSellerItemIds?.(authContext, productionPermissions.READ);
  return Boolean(ids?.length && await repository.findSellerTaskReferencingAsset(assetId, ids));
}

async function assertCanReadTasks(tasks, authContext) {
  const ids = await orderPublic.personalSellerItemIds?.(authContext, productionPermissions.READ);
  if (ids !== undefined) {
    const allowed = new Set(ids.map(String));
    if (tasks.some(task => !allowed.has(toId(task.orderItemId)))) throw forbidden();
    return;
  }
  tasks.forEach(task => assertCanAccessShop(task.shopId, productionPermissions.READ, authContext));
}

productionTaskService.canReadSellerTaskAsset = canReadSellerTaskAsset;
module.exports = productionTaskService;
