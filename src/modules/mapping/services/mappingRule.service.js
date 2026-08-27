const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const vendorPublic = require('../../vendor/public');
const {
  confidenceLevels,
  inputSources,
  mappingBlockingReasons,
  mappingPermissions,
  mappingScopeTypes,
  matchTargets,
  matchTypes,
  normalizationSeparators,
  normalizationPatterns,
  normalizationReasons,
  recordStatuses,
  ruleSpecificityFields,
  semanticRoles,
} = require('../constants/mappingRule.constants');
const normalizationRepository = require('../repositories/mappingNormalizationRule.repository');
const skuConfigRepository = require('../repositories/mappingSkuConfigRule.repository');
const skuNormalizeRepository = require('../repositories/mappingSkuNormalizeRule.repository');
const routingRepository = require('../repositories/vendorRoutingRule.repository');
const auditRepository = require('../repositories/mappingRuleAudit.repository');
const fulfillmentPlanRepository = require('../repositories/fulfillmentPlan.repository');
const { applySkuNormalizeRules } = require('./skuNormalization.helpers');
const {
  toNormalizationRuleDto,
  toPaginatedResponse,
  toRuleConflictDto,
  toRulePreviewDto,
  toSkuConfigRuleDto,
  toSkuNormalizeRuleDto,
  toVendorRoutingRuleDto,
} = require('../dtos/mappingRule.dto');

const MAPPING_READ = mappingPermissions.READ;
const MAPPING_WRITE = mappingPermissions.WRITE;
const SHOP_SCOPE_TYPE = mappingScopeTypes.SHOP;
const AUTO_RECHECK_LIMIT = 50;

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function validationError(message, details) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function conflict(message, details) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, details);
}

function hasGlobalPermission(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission) || (permission === MAPPING_READ && permissions.includes(MAPPING_WRITE));
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

function toAuthorableShop(scope) {
  const resource = scope.resource || {};
  return {
    id: String(scope.scopeId),
    name: resource.name || scope.name,
    code: resource.code || null,
    status: resource.status || null,
  };
}

async function listAllRegisteredShopScopes() {
  const query = {
    scopeType: SHOP_SCOPE_TYPE,
    status: 'active',
    page: 1,
    limit: 100,
  };
  const first = await authPublic.listScopes(query);
  const pageCount = Math.ceil(Number(first.total || 0) / Number(first.limit || query.limit));
  const pages = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => (
      authPublic.listScopes({ ...query, page: index + 2 })
    )))
    : [];
  return [...(first.items || []), ...pages.flatMap((page) => page.items || [])];
}

async function listAuthorableShops(authContext = {}) {
  const canCreateGlobal = hasGlobalPermission(authContext, MAPPING_WRITE);
  const scopes = canCreateGlobal
    ? await listAllRegisteredShopScopes()
    : (await Promise.all(getScopedShopIds(authContext, MAPPING_WRITE).map((scopeId) => (
      authPublic.listScopes({
        scopeType: SHOP_SCOPE_TYPE,
        scopeId,
        status: 'active',
        page: 1,
        limit: 1,
      })
    )))).flatMap((result) => result.items || []);

  return {
    canCreateGlobal,
    items: scopes
      .filter((scope) => scope.resource)
      .map(toAuthorableShop)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
  };
}

function assertCanAccessShop(shopId, permission, authContext = {}) {
  if (hasGlobalPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function assertRuleWriteAccess(shopId, authContext = {}) {
  if (shopId) {
    assertCanAccessShop(shopId, MAPPING_WRITE, authContext);
    return;
  }
  if (!hasGlobalPermission(authContext, MAPPING_WRITE)) throw forbidden();
}

function normalizeUpper(value) {
  return value === undefined || value === null || value === '' ? null : String(value).trim().toUpperCase();
}

function cleanStringArray(values = []) {
  return (values || []).map((value) => String(value || '').trim()).filter(Boolean);
}

function normalizePatch(patch = {}, fields = []) {
  return fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) result[field] = patch[field];
    return result;
  }, {});
}

function omitUndefined(payload = {}) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

async function recheckBlockedPlansAffectedByRule(rule = {}, authContext = {}) {
  const plans = await fulfillmentPlanRepository.listBlockedOrderItemIdsForRuleScope({
    shopId: rule.shopId || undefined,
    salesChannelCode: rule.salesChannelCode || undefined,
    marketplaceCode: rule.marketplaceCode || undefined,
    productTypeGroupId: rule.productTypeGroupId || undefined,
    configCode: rule.configCode || undefined,
    limit: AUTO_RECHECK_LIMIT,
  });
  const fulfillmentPlanService = require('./fulfillmentPlan.service');
  const result = { checked: 0, resolved: 0, blocked: 0, failed: 0 };
  for (const plan of plans) {
    try {
      const rechecked = await fulfillmentPlanService.recheckFulfillmentPlan(toId(plan.orderItemId), {}, {
        ...authContext,
        system: true,
        source: 'MAPPING_RULE_CHANGED',
      });
      result.checked += 1;
      if (rechecked?.status === 'READY') result.resolved += 1;
      else result.blocked += 1;
    } catch (error) {
      result.checked += 1;
      result.failed += 1;
    }
  }
  return result;
}

function safeRuleSnapshot(ruleType, rule) {
  if (ruleType === 'skuNormalize') return toSkuNormalizeRuleDto(rule);
  if (ruleType === 'skuConfig') return toSkuConfigRuleDto(rule);
  if (ruleType === 'vendorRouting') return toVendorRoutingRuleDto(rule);
  return toNormalizationRuleDto(rule);
}

async function recordRuleAudit(ruleType, ruleId, event, before, after, authContext = {}, session) {
  await auditRepository.create({
    ruleType,
    ruleId,
    event,
    actorAccountId: authContext.accountId || null,
    before: safeRuleSnapshot(ruleType, before),
    after: safeRuleSnapshot(ruleType, after),
  }, { session });
}

function auditEventForPatch(patch = {}) {
  return Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, 'status')
    ? 'STATUS_CHANGED'
    : 'UPDATED';
}

function auditEventForChange(ruleType, before, after) {
  if (!before) return 'CREATED';
  const ignored = new Set(['id', 'createdAt', 'updatedAt']);
  const previous = safeRuleSnapshot(ruleType, before);
  const current = safeRuleSnapshot(ruleType, after);
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter((key) => !ignored.has(key) && JSON.stringify(previous[key]) !== JSON.stringify(current[key]));
  return changed.length === 1 && changed[0] === 'status' ? 'STATUS_CHANGED' : 'UPDATED';
}

function isTransactionUnsupported(error) {
  return error?.code === 20
    && /transaction numbers are only allowed|transactions are not supported/i.test(error.message || '');
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    if (isTransactionUnsupported(error)) return work(undefined);
    throw error;
  } finally {
    await session.endSession();
  }
}

function assertShopIsImmutable(patch = {}) {
  if (Object.prototype.hasOwnProperty.call(patch, 'shopId')) {
    throw validationError('shopId is immutable', { field: 'shopId' });
  }
}

function normalizeProvidedUpperFields(payload = {}, fields = []) {
  return fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) result[field] = normalizeUpper(payload[field]);
    return result;
  }, {});
}

function scopedQuery(query = {}, authContext = {}, permission = MAPPING_READ) {
  if (hasGlobalPermission(authContext, permission)) return query;
  const shopIds = getScopedShopIds(authContext, permission);
  if (query.shopId) {
    if (!shopIds.includes(String(query.shopId))) return { ...query, shopIds: [] };
    return query;
  }
  return { ...query, shopIds };
}

function normalizeRulePayload(payload = {}, { defaults = false } = {}) {
  if (String(payload.matchType || '').toUpperCase() === matchTypes.REGEX) {
    throw validationError('REGEX matchType is disabled in V1', { field: 'matchType' });
  }
  return {
    ...payload,
    ...normalizeProvidedUpperFields(payload, [
      'salesChannelCode',
      'marketplaceCode',
      'semanticRole',
      'matchTarget',
      'matchType',
    ]),
    status: normalizeUpper(payload.status) || (defaults ? recordStatuses.ACTIVE : undefined),
  };
}

function normalizeRoutingPayload(payload = {}, { defaults = false } = {}) {
  return {
    ...payload,
    ...normalizeProvidedUpperFields(payload, [
      'salesChannelCode',
      'marketplaceCode',
      'asin',
      'configCode',
      'normalizedSize',
      'normalizedColor',
    ]),
    status: normalizeUpper(payload.status) || (defaults ? recordStatuses.ACTIVE : undefined),
  };
}

function normalizeSkuConfigPayload(payload = {}, { defaults = false } = {}) {
  const arrayField = (field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) return cleanStringArray(payload[field]);
    return defaults ? [] : undefined;
  };
  const productTypeAliases = arrayField('productTypeAliases');
  return {
    ...payload,
    ...normalizeProvidedUpperFields(payload, [
      'salesChannelCode',
      'marketplaceCode',
      'configCode',
      'platformProductType',
      'countryCode',
    ]),
    productTypeAliases: productTypeAliases ? productTypeAliases.map(normalizeUpper).filter(Boolean) : undefined,
    sizeKeys: arrayField('sizeKeys'),
    colorKeys: arrayField('colorKeys'),
    productTypeKeys: arrayField('productTypeKeys'),
    productTypeColorKeys: arrayField('productTypeColorKeys'),
    productTypeSizeKeys: arrayField('productTypeSizeKeys'),
    combinationKeys: arrayField('combinationKeys'),
    attributeKeyMap: Object.prototype.hasOwnProperty.call(payload, 'attributeKeyMap')
      ? payload.attributeKeyMap || {}
      : defaults ? {} : undefined,
    defaultColor: Object.prototype.hasOwnProperty.call(payload, 'defaultColor')
      ? normalizeUpper(payload.defaultColor)
      : defaults ? null : undefined,
    status: normalizeUpper(payload.status) || (defaults ? recordStatuses.ACTIVE : undefined),
  };
}

function normalizeSkuNormalizePayload(payload = {}, { defaults = false } = {}) {
  return {
    ...payload,
    ...normalizeProvidedUpperFields(payload, [
      'salesChannelCode',
      'marketplaceCode',
      'configCode',
      'patternType',
      'segmentRole',
      'outputAction',
      'replacementValue',
    ]),
    ...(Object.prototype.hasOwnProperty.call(payload, 'appliesWhenValues') || defaults
      ? { appliesWhenValues: (payload.appliesWhenValues || []).map(normalizeUpper).filter(Boolean) }
      : {}),
    status: normalizeUpper(payload.status) || (defaults ? recordStatuses.ACTIVE : undefined),
  };
}

async function assertActiveVendor(vendorId) {
  assertValidObjectId(vendorId, 'vendorId');
  const vendor = await vendorPublic.getVendorById(vendorId);
  if (!vendor) throw notFound('Vendor not found');
  return vendor;
}

async function assertActiveProductTypeGroup(productTypeGroupId) {
  assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  const group = await catalogPublic.getProductTypeGroupById(productTypeGroupId);
  if (!group) throw notFound('Product type group not found');
  return group;
}

async function assertActiveInternalTemplate(internalTemplateId) {
  if (!internalTemplateId) return null;
  assertValidObjectId(internalTemplateId, 'internalTemplateId');
  const template = await catalogPublic.getInternalTemplateById(internalTemplateId);
  if (!template) throw notFound('Internal template not found');
  return template;
}

async function mapDuplicate(error, message) {
  if (error && error.code === 11000) throw conflict(message);
  throw error;
}

async function listNormalizationRules(query = {}, authContext = {}) {
  const result = await normalizationRepository.list(scopedQuery(query, authContext, MAPPING_READ));
  return toPaginatedResponse(result, toNormalizationRuleDto);
}

async function listNormalizationRuleGroups(query = {}, authContext = {}) {
  const result = await normalizationRepository.listGrouped(scopedQuery(query, authContext, MAPPING_READ));
  return {
    semanticRules: toPaginatedResponse(result.semanticRules, toNormalizationRuleDto),
    valueAliases: toPaginatedResponse(result.valueAliases, toNormalizationRuleDto),
  };
}

async function getNormalizationRule(ruleId, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const rule = await normalizationRepository.findById(ruleId);
  if (!rule) throw notFound('Normalization rule not found');
  if (rule.shopId) assertCanAccessShop(rule.shopId, MAPPING_READ, authContext);
  return toNormalizationRuleDto(rule);
}

async function createNormalizationRule(payload, authContext = {}) {
  const normalized = normalizeRulePayload(payload, { defaults: true });
  assertRuleWriteAccess(normalized.shopId, authContext);
  const created = await withTransaction(async (session) => {
    const rule = await normalizationRepository.create(normalized, { session });
    await recordRuleAudit('normalization', toId(rule), 'CREATED', null, rule, authContext, session);
    return rule;
  });
  return {
    ...toNormalizationRuleDto(created),
    autoRecheck: await recheckBlockedPlansAffectedByRule(created, authContext),
  };
}

async function updateNormalizationRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  assertShopIsImmutable(patch);
  const updatePatch = omitUndefined(normalizeRulePayload(normalizePatch(patch, [
    'salesChannelCode',
    'marketplaceCode',
    'productTypeGroupId',
    'semanticRole',
    'matchTarget',
    'matchType',
    'matchValue',
    'normalizedValue',
    'priority',
    'status',
  ])));
  const updated = await withTransaction(async (session) => {
    const existing = await normalizationRepository.findById(ruleId, { session });
    if (!existing) throw notFound('Normalization rule not found');
    assertRuleWriteAccess(existing.shopId, authContext);
    const rule = await normalizationRepository.update(ruleId, updatePatch, { session });
    await recordRuleAudit('normalization', ruleId, auditEventForChange('normalization', existing, rule), existing, rule, authContext, session);
    return rule;
  });
  return {
    ...toNormalizationRuleDto(updated),
    autoRecheck: await recheckBlockedPlansAffectedByRule(updated, authContext),
  };
}

async function listVendorRoutingRules(query = {}, authContext = {}) {
  const result = await routingRepository.list(scopedQuery(query, authContext, MAPPING_READ));
  return toPaginatedResponse(result, toVendorRoutingRuleDto);
}

async function getVendorRoutingRule(ruleId, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const rule = await routingRepository.findById(ruleId);
  if (!rule) throw notFound('Vendor routing rule not found');
  if (rule.shopId) assertCanAccessShop(rule.shopId, MAPPING_READ, authContext);
  return toVendorRoutingRuleDto(rule);
}

async function createVendorRoutingRule(payload, authContext = {}) {
  const normalized = normalizeRoutingPayload(payload, { defaults: true });
  assertRuleWriteAccess(normalized.shopId, authContext);
  await assertActiveVendor(normalized.vendorId);
  const created = await withTransaction(async (session) => {
    const rule = await routingRepository.create(normalized, { session });
    await recordRuleAudit('vendorRouting', toId(rule), 'CREATED', null, rule, authContext, session);
    return rule;
  });
  return {
    ...toVendorRoutingRuleDto(created),
    autoRecheck: await recheckBlockedPlansAffectedByRule(created, authContext),
  };
}

async function updateVendorRoutingRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  assertShopIsImmutable(patch);
  const updatePatch = omitUndefined(normalizeRoutingPayload(normalizePatch(patch, [
    'salesChannelCode',
    'marketplaceCode',
    'productTypeGroupId',
    'vendorId',
    'asin',
    'configCode',
    'normalizedSize',
    'normalizedColor',
    'priority',
    'status',
  ])));
  if (updatePatch.vendorId) await assertActiveVendor(updatePatch.vendorId);
  const updated = await withTransaction(async (session) => {
    const existing = await routingRepository.findById(ruleId, { session });
    if (!existing) throw notFound('Vendor routing rule not found');
    assertRuleWriteAccess(existing.shopId, authContext);
    const rule = await routingRepository.update(ruleId, updatePatch, { session });
    await recordRuleAudit('vendorRouting', ruleId, auditEventForChange('vendorRouting', existing, rule), existing, rule, authContext, session);
    return rule;
  });
  return {
    ...toVendorRoutingRuleDto(updated),
    autoRecheck: await recheckBlockedPlansAffectedByRule(updated, authContext),
  };
}

async function reorderVendorRoutingRules(payload = {}, authContext = {}) {
  const scope = normalizeRoutingPayload({
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    productTypeGroupId: payload.productTypeGroupId,
  });
  assertRuleWriteAccess(scope.shopId, authContext);
  const seen = new Set();
  const ranks = payload.vendorRanks || [];
  ranks.forEach((rank) => {
    if (seen.has(String(rank.vendorId))) {
      throw validationError('vendorRanks must not contain duplicate vendorId', { field: 'vendorRanks' });
    }
    seen.add(String(rank.vendorId));
  });
  const items = await withTransaction(async (session) => {
    const updated = [];
    for (const rank of ranks) {
      await assertActiveVendor(rank.vendorId);
      const before = await routingRepository.findForScopeVendor(scope, rank.vendorId, { session });
      const rule = await routingRepository.upsertForScope(scope, {
        vendorId: rank.vendorId,
        priority: rank.priority,
        status: recordStatuses.ACTIVE,
      }, { session });
      await recordRuleAudit(
        'vendorRouting',
        toId(rule),
        auditEventForChange('vendorRouting', before, rule),
        before,
        rule,
        authContext,
        session,
      );
      updated.push(rule);
    }
    return updated;
  });
  return {
    items: items.sort((a, b) => (a.priority || 100) - (b.priority || 100)).map(toVendorRoutingRuleDto),
    autoRecheck: await recheckBlockedPlansAffectedByRule(scope, authContext),
  };
}

async function listSkuConfigRules(query = {}, authContext = {}) {
  const result = await skuConfigRepository.list(scopedQuery(query, authContext, MAPPING_READ));
  return toPaginatedResponse(result, toSkuConfigRuleDto);
}

async function getSkuConfigRule(ruleId, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const rule = await skuConfigRepository.findById(ruleId);
  if (!rule) throw notFound('SKU config rule not found');
  if (rule.shopId) assertCanAccessShop(rule.shopId, MAPPING_READ, authContext);
  return toSkuConfigRuleDto(rule);
}

async function createSkuConfigRule(payload, authContext = {}) {
  const normalized = normalizeSkuConfigPayload(payload, { defaults: true });
  assertRuleWriteAccess(normalized.shopId, authContext);
  await assertActiveProductTypeGroup(normalized.productTypeGroupId);
  await assertActiveInternalTemplate(normalized.internalTemplateId);
  try {
    const created = await withTransaction(async (session) => {
      const rule = await skuConfigRepository.create(normalized, { session });
      await recordRuleAudit('skuConfig', toId(rule), 'CREATED', null, rule, authContext, session);
      return rule;
    });
    return {
      ...toSkuConfigRuleDto(created),
      autoRecheck: await recheckBlockedPlansAffectedByRule(created, authContext),
    };
  } catch (error) {
    await mapDuplicate(error, 'SKU config rule already exists for this scope');
  }
}

async function updateSkuConfigRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  assertShopIsImmutable(patch);
  const updatePatch = omitUndefined(normalizeSkuConfigPayload(normalizePatch(patch, [
    'salesChannelCode',
    'marketplaceCode',
    'configCode',
    'productTypeAliases',
    'platformProductType',
    'countryCode',
    'combinationProductTypeKey',
    'sizeKeys',
    'colorKeys',
    'productTypeKeys',
    'productTypeColorKeys',
    'productTypeSizeKeys',
    'combinationKeys',
    'attributeKeyMap',
    'defaultColor',
    'isSet',
    'isPack',
    'sizePosition',
    'colorPosition',
    'productTypeGroupId',
    'internalTemplateId',
    'priority',
    'status',
  ])));
  if (updatePatch.productTypeGroupId) await assertActiveProductTypeGroup(updatePatch.productTypeGroupId);
  if (updatePatch.internalTemplateId) await assertActiveInternalTemplate(updatePatch.internalTemplateId);
  try {
    const updated = await withTransaction(async (session) => {
      const existing = await skuConfigRepository.findById(ruleId, { session });
      if (!existing) throw notFound('SKU config rule not found');
      assertRuleWriteAccess(existing.shopId, authContext);
      const rule = await skuConfigRepository.update(ruleId, updatePatch, { session });
      await recordRuleAudit('skuConfig', ruleId, auditEventForChange('skuConfig', existing, rule), existing, rule, authContext, session);
      return rule;
    });
    return {
      ...toSkuConfigRuleDto(updated),
      autoRecheck: await recheckBlockedPlansAffectedByRule(updated, authContext),
    };
  } catch (error) {
    await mapDuplicate(error, 'SKU config rule already exists for this scope');
  }
}

async function listActiveSkuConfigRulesForContext(context = {}) {
  if (!context.configCode) return [];
  return (await skuConfigRepository.findActiveForContext(context)).sort((a, b) => (
    specificity(b, context) - specificity(a, context)
    || (a.priority || 100) - (b.priority || 100)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a._id || a.id).localeCompare(String(b._id || b.id))
  ));
}

async function listSkuNormalizeRules(query = {}, authContext = {}) {
  const result = await skuNormalizeRepository.list(scopedQuery(query, authContext, MAPPING_READ));
  return toPaginatedResponse(result, toSkuNormalizeRuleDto);
}

async function getSkuNormalizeRule(ruleId, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const rule = await skuNormalizeRepository.findById(ruleId);
  if (!rule) throw notFound('SKU normalize rule not found');
  if (rule.shopId) assertCanAccessShop(rule.shopId, MAPPING_READ, authContext);
  return toSkuNormalizeRuleDto(rule);
}

async function createSkuNormalizeRule(payload, authContext = {}) {
  const normalized = normalizeSkuNormalizePayload(payload, { defaults: true });
  assertRuleWriteAccess(normalized.shopId, authContext);
  const created = await withTransaction(async (session) => {
    const rule = await skuNormalizeRepository.create(normalized, { session });
    await recordRuleAudit('skuNormalize', toId(rule), 'CREATED', null, rule, authContext, session);
    return rule;
  });
  return {
    ...toSkuNormalizeRuleDto(created),
    autoRecheck: await recheckBlockedPlansAffectedByRule(created, authContext),
  };
}

async function updateSkuNormalizeRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  assertShopIsImmutable(patch);
  const updatePatch = omitUndefined(normalizeSkuNormalizePayload(normalizePatch(patch, [
    'salesChannelCode',
    'marketplaceCode',
    'configCode',
    'patternType',
    'segmentIndex',
    'segmentRole',
    'appliesWhenValues',
    'outputAction',
    'replacementValue',
    'priority',
    'status',
  ])));
  const updated = await withTransaction(async (session) => {
    const existing = await skuNormalizeRepository.findById(ruleId, { session });
    if (!existing) throw notFound('SKU normalize rule not found');
    assertRuleWriteAccess(existing.shopId, authContext);
    const rule = await skuNormalizeRepository.update(ruleId, updatePatch, { session });
    await recordRuleAudit('skuNormalize', ruleId, auditEventForChange('skuNormalize', existing, rule), existing, rule, authContext, session);
    return rule;
  });
  return {
    ...toSkuNormalizeRuleDto(updated),
    autoRecheck: await recheckBlockedPlansAffectedByRule(updated, authContext),
  };
}

async function listActiveSkuNormalizeRulesForContext(context = {}) {
  const rules = await skuNormalizeRepository.listActiveForContext(context);
  return rules.sort((a, b) => (
    specificity(b, context) - specificity(a, context)
    || (a.priority || 100) - (b.priority || 100)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a._id || a.id).localeCompare(String(b._id || b.id))
  ));
}

async function normalizeSkuForContext(sku, context = {}) {
  return applySkuNormalizeRules(sku, await listActiveSkuNormalizeRulesForContext(context));
}

function assertRuleReadAccess(shopId, authContext = {}) {
  if (shopId) {
    assertCanAccessShop(shopId, MAPPING_READ, authContext);
    return;
  }
  if (
    !hasGlobalPermission(authContext, MAPPING_READ)
    && getScopedShopIds(authContext, MAPPING_READ).length === 0
  ) {
    throw forbidden();
  }
}

function visibleToReader(rule, authContext = {}) {
  return !rule.shopId || hasGlobalPermission(authContext, MAPPING_READ)
    || authPublic.canAccessScope(authContext, MAPPING_READ, { scopeType: SHOP_SCOPE_TYPE, scopeId: rule.shopId });
}

function normalizeEvaluationRule(ruleType, rule) {
  if (ruleType === 'skuNormalize') return normalizeSkuNormalizePayload(rule, { defaults: true });
  if (ruleType === 'skuConfig') return normalizeSkuConfigPayload(rule, { defaults: true });
  if (ruleType === 'vendorRouting') return normalizeRoutingPayload(rule, { defaults: true });
  return normalizeRulePayload({
    ...rule,
    matchTarget: ruleType === 'semanticRules' ? matchTargets.LABEL : matchTargets.VALUE,
  }, { defaults: true });
}

function evaluateSkuNormalizeSample(rule, input) {
  const result = applySkuNormalizeRules(input, [rule]);
  return { input, output: result.canonicalSku, matched: result.appliedRuleIds.length > 0 };
}

function evaluateVendorRoutingSample(rule, input) {
  const text = normalizeUpper(input);
  const checks = ['asin', 'configCode', 'normalizedSize', 'normalizedColor']
    .map((field) => rule[field])
    .filter(Boolean);
  const matched = checks.length === 0 || checks.every((value) => text.includes(normalizeUpper(value)));
  return {
    input,
    output: matched ? toId(rule.vendorId) : null,
    matched,
    vendorId: toId(rule.vendorId),
    productTypeGroupId: toId(rule.productTypeGroupId),
  };
}

function evaluateRuleSample(ruleType, rule, input) {
  if (ruleType === 'skuNormalize') return evaluateSkuNormalizeSample(rule, input);
  if (ruleType === 'skuConfig') {
    return {
      input,
      output: rule.productTypeGroupId ? toId(rule.productTypeGroupId) : null,
      matched: normalizeUpper(input) === normalizeUpper(rule.configCode),
      configCode: rule.configCode,
      productTypeGroupId: toId(rule.productTypeGroupId),
      internalTemplateId: toId(rule.internalTemplateId),
      platformProductType: rule.platformProductType || null,
    };
  }
  if (ruleType === 'vendorRouting') return evaluateVendorRoutingSample(rule, input);
  const matched = ruleMatches(rule, { label: input, value: input });
  return {
    input,
    output: matched ? (rule.normalizedValue || input) : null,
    matched,
    semanticRole: rule.semanticRole,
    matchValue: rule.matchValue,
    normalizedValue: rule.normalizedValue || null,
    productTypeGroupId: toId(rule.productTypeGroupId),
  };
}

function optionalPatternOverlap(left, right, field) {
  return !left[field] || !right[field] || sameScopeValue(left[field], right[field]);
}

function sameRulePattern(ruleType, left, right) {
  if (ruleType === 'skuNormalize') {
    return left.patternType === right.patternType
      && left.segmentIndex === right.segmentIndex
      && (left.appliesWhenValues || []).some((value) => (right.appliesWhenValues || [])
        .map(normalizeUpper).includes(normalizeUpper(value)));
  }
  if (ruleType === 'skuConfig') return normalizeUpper(left.configCode) === normalizeUpper(right.configCode);
  if (ruleType === 'vendorRouting') {
    return sameScopeValue(left.productTypeGroupId, right.productTypeGroupId)
      && sameScopeValue(left.vendorId, right.vendorId)
      && ['asin', 'configCode', 'normalizedSize', 'normalizedColor']
        .every((field) => optionalPatternOverlap(left, right, field));
  }
  return left.semanticRole === right.semanticRole
    && left.matchTarget === right.matchTarget
    && left.matchType === right.matchType
    && lower(left.matchValue) === lower(right.matchValue);
}

const ruleScopeFields = Object.freeze([
  'shopId',
  'salesChannelCode',
  'marketplaceCode',
  'productTypeGroupId',
  'countryCode',
  'configCode',
]);

function sameScopeValue(left, right) {
  return normalizeUpper(left) === normalizeUpper(right);
}

function scopesOverlap(left, right) {
  return ruleScopeFields.every((field) => !left[field] || !right[field] || sameScopeValue(left[field], right[field]));
}

function sameRuleScope(left, right) {
  return ruleScopeFields.every((field) => sameScopeValue(left[field], right[field]));
}

function repositoryForRuleType(ruleType) {
  if (ruleType === 'skuNormalize') return skuNormalizeRepository;
  if (ruleType === 'skuConfig') return skuConfigRepository;
  if (ruleType === 'vendorRouting') return routingRepository;
  return normalizationRepository;
}

const historyRuleTypes = Object.freeze({
  normalization: { repository: normalizationRepository, auditRuleType: 'normalization' },
  semanticRules: { repository: normalizationRepository, auditRuleType: 'normalization' },
  valueAliases: { repository: normalizationRepository, auditRuleType: 'normalization' },
  vendorRouting: { repository: routingRepository, auditRuleType: 'vendorRouting' },
  skuConfig: { repository: skuConfigRepository, auditRuleType: 'skuConfig' },
  skuNormalize: { repository: skuNormalizeRepository, auditRuleType: 'skuNormalize' },
});

async function listRuleHistory(ruleType, ruleId, authContext = {}) {
  const config = historyRuleTypes[ruleType];
  if (!config) throw validationError('Unsupported ruleType', { field: 'ruleType' });
  assertValidObjectId(ruleId, 'ruleId');
  const rule = await config.repository.findById(ruleId);
  if (!rule) throw notFound('Mapping rule not found');
  assertRuleReadAccess(rule.shopId, authContext);
  const items = await auditRepository.listByRule(config.auditRuleType, ruleId);
  return {
    items: [...items].sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      || String(right._id || '').localeCompare(String(left._id || ''))
    )),
  };
}

async function listAllRules(repository, query) {
  const first = await repository.list({ ...query, page: 1, limit: 100 });
  const { total = 0, limit = 100 } = first.pagination || {};
  const pageCount = Math.ceil(total / limit);
  if (pageCount <= 1) return first.items || [];
  const pages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => (
    repository.list({ ...query, page: index + 2, limit })
  )));
  return [
    ...(first.items || []),
    ...pages.flatMap((page) => page.items || []),
  ];
}

async function previewRule({ ruleType, rule, samples = [] }, authContext = {}) {
  const normalizedRule = normalizeEvaluationRule(ruleType, rule);
  assertRuleReadAccess(normalizedRule.shopId, authContext);
  return toRulePreviewDto(ruleType, samples.map((input) => evaluateRuleSample(ruleType, normalizedRule, input)));
}

async function findRuleConflicts({ ruleId, ruleType, rule }, authContext = {}) {
  const normalizedRule = normalizeEvaluationRule(ruleType, rule);
  assertRuleReadAccess(normalizedRule.shopId, authContext);
  const rules = await listAllRules(repositoryForRuleType(ruleType), scopedQuery({
    status: recordStatuses.ACTIVE,
  }, authContext, MAPPING_READ));
  const conflicts = rules
    .filter((existing) => String(existing._id || existing.id) !== String(ruleId || '')
      && visibleToReader(existing, authContext)
      && scopesOverlap(normalizedRule, existing)
      && sameRulePattern(ruleType, normalizedRule, existing))
    .map((existing) => ({
      dto: toRuleConflictDto(
        existing,
        sameRuleScope(normalizedRule, existing) ? 'ERROR' : 'WARNING',
        sameRuleScope(normalizedRule, existing) ? 'EXACT_SCOPE_PATTERN' : 'BROADER_SCOPE_PATTERN',
      ),
      exactScope: sameRuleScope(normalizedRule, existing),
    }))
    .sort((left, right) => Number(right.exactScope) - Number(left.exactScope)
      || left.dto.priority - right.dto.priority
      || left.dto.id.localeCompare(right.dto.id))
    .map(({ dto }) => dto);
  return { conflicts };
}

function toRawInputs(customerInputs = {}) {
  return [
    ...(customerInputs.options || []),
    ...(customerInputs.texts || []),
  ].map((input) => ({
    label: String(input.label || input.name || '').trim(),
    value: input.value === undefined || input.value === null ? '' : String(input.value).trim(),
  })).filter((input) => input.label || input.value);
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function parseDecoratedValue(value) {
  const original = String(value || '');
  const annotations = [...original.matchAll(normalizationPatterns.PARENTHETICAL)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  const cleaned = original
    .replace(normalizationPatterns.PARENTHETICAL, '')
    .replace(normalizationPatterns.WHITESPACE, ' ')
    .trim();
  return {
    value: cleaned.toUpperCase(),
    annotations,
    flags: {
      outOfStock: normalizationPatterns.OUT_OF_STOCK.test(original),
    },
  };
}

function normalizeDimensionSize(value) {
  const normalized = String(value || '')
    .toUpperCase()
    .replace(normalizationPatterns.DIMENSION_UNITS, ' ')
    .replace(normalizationPatterns.DIMENSION_MULTIPLY, 'X')
    .replace(normalizationPatterns.WHITESPACE, ' ')
    .trim();
  const match = normalized.match(normalizationPatterns.DIMENSION_SIZE);
  return match ? `${match[1]}X${match[2]}` : null;
}

function ruleMatches(rule, input) {
  const target = rule.matchTarget === matchTargets.VALUE
    ? input.value
    : rule.matchTarget === matchTargets.LABEL_AND_VALUE
      ? `${input.label} ${input.value}`
      : input.label;
  if (rule.matchType === matchTypes.EXACT) return lower(target) === lower(rule.matchValue);
  return lower(target).includes(lower(rule.matchValue));
}

function specificity(rule = {}, context = {}) {
  return ruleSpecificityFields
    .filter((field) => rule[field] && String(rule[field]) === String(context[field])).length;
}

function ruleInput(rule, input, context) {
  const parsed = parseDecoratedValue(rule.normalizedValue || input.value);
  const dimensionSize = rule.semanticRole === semanticRoles.SIZE && (
    normalizeDimensionSize(parsed.value)
    || parsed.annotations.map(normalizeDimensionSize).find(Boolean)
  );
  return {
    semanticRole: rule.semanticRole,
    value: dimensionSize || parsed.value,
    originalLabel: input.label,
    originalValue: input.value,
    confidence: confidenceLevels.HIGH,
    reason: dimensionSize
      ? normalizationReasons.DIMENSION_SIZE_HEURISTIC
      : parsed.flags.outOfStock || parsed.annotations.length
      ? normalizationReasons.RULE_WITH_ANNOTATION
      : normalizationReasons.RULE,
    source: inputSources.RULE,
    ruleId: String(rule._id || rule.id),
    annotations: parsed.annotations,
    flags: parsed.flags,
    specificity: specificity(rule, context),
  };
}

function isCompositeSemanticRole(role) {
  return role === semanticRoles.PRODUCT_TYPE_COLOR || role === semanticRoles.PRODUCT_TYPE_SIZE;
}

function combinedRuleInputs(rule, input, context, roles) {
  const parsed = parseDecoratedValue(rule.normalizedValue || input.value);
  return combinedBucketInputs(input, roles, parsed.value).map((item) => ({
    ...item,
    confidence: confidenceLevels.HIGH,
    reason: parsed.flags.outOfStock || parsed.annotations.length
      ? normalizationReasons.RULE_WITH_ANNOTATION
      : normalizationReasons.RULE,
    source: inputSources.RULE,
    ruleId: String(rule._id || rule.id),
    annotations: parsed.annotations,
    flags: parsed.flags,
    specificity: specificity(rule, context),
    composite: true,
  }));
}

function normalizedRuleInputs(rule, input, context) {
  if (rule.semanticRole === semanticRoles.PRODUCT_TYPE_COLOR) {
    return combinedRuleInputs(rule, input, context, [semanticRoles.PRODUCT_TYPE, semanticRoles.COLOR]);
  }
  if (rule.semanticRole === semanticRoles.PRODUCT_TYPE_SIZE) {
    return combinedRuleInputs(rule, input, context, [semanticRoles.PRODUCT_TYPE, semanticRoles.SIZE]);
  }
  return [ruleInput(rule, input, context)];
}

function labelMatchesKey(input = {}, keys = []) {
  return cleanStringArray(keys).some((key) => lower(input.label) === lower(key));
}

function bucketInput(input, semanticRole, value = input.value) {
  const parsed = parseDecoratedValue(value);
  const dimensionSize = semanticRole === semanticRoles.SIZE && (
    normalizeDimensionSize(parsed.value)
    || parsed.annotations.map(normalizeDimensionSize).find(Boolean)
  );
  return {
    semanticRole,
    value: dimensionSize || parsed.value,
    originalLabel: input.label,
    originalValue: input.value,
    confidence: confidenceLevels.HIGH,
    reason: normalizationReasons.SKU_CONFIG_KEY_BUCKET,
    source: inputSources.SKU_CONFIG,
    ruleId: null,
    annotations: parsed.annotations,
    flags: parsed.flags,
  };
}

function combinedBucketInputs(input, roles, value = input.value) {
  const parsed = parseDecoratedValue(value);
  const parts = parsed.value
    .split(normalizationSeparators.PRODUCT_COLOR)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [bucketInput(input, roles[0])];
  return roles.map((role, index) => ({
    ...bucketInput(input, role, parts[index] || ''),
    annotations: parsed.annotations,
    flags: parsed.flags,
  })).filter((item) => item.value);
}

function skuConfigInputs(rawInputs = [], parsingConfig = {}) {
  return rawInputs.flatMap((input) => {
    if (labelMatchesKey(input, parsingConfig.productTypeColorKeys)
      || labelMatchesKey(input, parsingConfig.combinationKeys)) {
      return combinedBucketInputs(input, [semanticRoles.PRODUCT_TYPE, semanticRoles.COLOR]);
    }
    if (labelMatchesKey(input, parsingConfig.productTypeSizeKeys)) {
      return combinedBucketInputs(input, [semanticRoles.PRODUCT_TYPE, semanticRoles.SIZE]);
    }
    if (labelMatchesKey(input, parsingConfig.sizeKeys)) return [bucketInput(input, semanticRoles.SIZE)];
    if (labelMatchesKey(input, parsingConfig.colorKeys)) return [bucketInput(input, semanticRoles.COLOR)];
    if (labelMatchesKey(input, parsingConfig.productTypeKeys)) return [bucketInput(input, semanticRoles.PRODUCT_TYPE)];
    return [];
  });
}

function templateMetadataInputs(rawInputs, internalTemplate = {}) {
  return (internalTemplate.requiredFields || []).flatMap((field) => {
    const role = normalizeUpper(field.validation && field.validation.semanticRole);
    if (!role) return [];
    const match = rawInputs.find((input) => (
      lower(input.label) === lower(field.label)
      || lower(input.label) === lower(field.key)
      || lower(input.label).includes(lower(field.label || field.key))
    ));
    if (!match) return [];
    const parsed = parseDecoratedValue(match.value);
    const dimensionSize = role === semanticRoles.SIZE && (
      normalizeDimensionSize(parsed.value)
      || parsed.annotations.map(normalizeDimensionSize).find(Boolean)
    );
    return [{
      semanticRole: role,
      value: dimensionSize || parsed.value,
      originalLabel: match.label,
      originalValue: match.value,
      confidence: confidenceLevels.HIGH,
      reason: dimensionSize
        ? normalizationReasons.DIMENSION_SIZE_HEURISTIC
        : normalizationReasons.INTERNAL_TEMPLATE_SEMANTIC_ROLE,
      source: inputSources.TEMPLATE_METADATA,
      ruleId: null,
      annotations: parsed.annotations,
      flags: parsed.flags,
    }];
  });
}

function dedupeInputs(inputs = []) {
  const byRole = new Map();
  inputs.forEach((input) => {
    const current = byRole.get(input.semanticRole);
    if (input.semanticRole === semanticRoles.COLOR && current) {
      const inputIsPack = lower(input.originalLabel).includes('pack');
      const currentIsPack = lower(current.originalLabel).includes('pack');
      if (inputIsPack && !currentIsPack) {
        byRole.set(input.semanticRole, input);
        return;
      }
      if (!inputIsPack && currentIsPack) return;
    }
    const inputSpecificity = input.specificity || 0;
    const currentSpecificity = current?.specificity || 0;
    const inputSourcePriority = input.composite ? 2 : input.source === inputSources.SKU_CONFIG ? 1 : 0;
    const currentSourcePriority = current?.composite ? 2 : current?.source === inputSources.SKU_CONFIG ? 1 : 0;
    if (!current
      || inputSpecificity > currentSpecificity
      || (inputSpecificity === currentSpecificity && inputSourcePriority > currentSourcePriority)) {
      byRole.set(input.semanticRole, input);
    }
  });
  return [...byRole.values()].map(({ specificity: _specificity, composite: _composite, ...input }) => input);
}

function missingRequiredFields(requiredFields = [], normalizedInputs = [], rawInputs = []) {
  return requiredFields.filter((field) => {
    if (!field.required) return false;
    const role = normalizeUpper(field.validation && field.validation.semanticRole);
    if (role && normalizedInputs.some((input) => input.semanticRole === role && input.value)) return false;
    return !rawInputs.some((input) => (
      input.value
      && (lower(input.label) === lower(field.label) || lower(input.label) === lower(field.key))
    ));
  });
}

async function buildNormalizedInputs({
  context = {},
  customerInputs = {},
  internalTemplate = {},
  parsingConfig = {},
} = {}) {
  const rawInputs = toRawInputs(customerInputs);
  const rules = await normalizationRepository.listActiveForContext(context);
  const ruleInputs = rawInputs.flatMap((input) => {
    const matched = rules
      .filter((rule) => ruleMatches(rule, input))
      .sort((a, b) => (
        Number(isCompositeSemanticRole(b.semanticRole)) - Number(isCompositeSemanticRole(a.semanticRole))
        || specificity(b, context) - specificity(a, context)
        || (a.priority || 100) - (b.priority || 100)
      ));
    return matched[0] ? normalizedRuleInputs(matched[0], input, context) : [];
  });
  const normalizedInputs = dedupeInputs([
    ...ruleInputs,
    ...skuConfigInputs(rawInputs, parsingConfig),
    ...templateMetadataInputs(rawInputs, internalTemplate),
  ]);
  const blockingReasons = [];
  if (normalizedInputs.some((input) => input.flags && input.flags.outOfStock)) {
    blockingReasons.push(mappingBlockingReasons.SELECTED_OPTION_OUT_OF_STOCK);
  }
  if (missingRequiredFields(internalTemplate.requiredFields || [], normalizedInputs, rawInputs).length) {
    blockingReasons.push(mappingBlockingReasons.TEMPLATE_REQUIRED_INPUT_MISSING);
  }
  return { normalizedInputs, blockingReasons };
}

async function listActiveVendorRoutingRulesForContext(context = {}) {
  const rules = await routingRepository.listActiveForContext(context);
  const activeRules = [];
  for (const rule of rules) {
    const vendor = await vendorPublic.getVendorById(rule.vendorId);
    if (!vendor) continue;
    activeRules.push({
      ...rule,
      specificity: specificity(rule, context),
    });
  }
  return activeRules.sort((a, b) => (
    b.specificity - a.specificity
    || (a.priority || 100) - (b.priority || 100)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a._id || a.id).localeCompare(String(b._id || b.id))
  ));
}

module.exports = {
  buildNormalizedInputs,
  createNormalizationRule,
  createSkuConfigRule,
  createSkuNormalizeRule,
  createVendorRoutingRule,
  findRuleConflicts,
  listRuleHistory,
  listActiveSkuConfigRulesForContext,
  listActiveSkuNormalizeRulesForContext,
  normalizeSkuForContext,
  listAuthorableShops,
  getNormalizationRule,
  getSkuConfigRule,
  getSkuNormalizeRule,
  getVendorRoutingRule,
  listSkuConfigRules,
  listSkuNormalizeRules,
  listActiveVendorRoutingRulesForContext,
  listNormalizationRules,
  listNormalizationRuleGroups,
  listVendorRoutingRules,
  previewRule,
  reorderVendorRoutingRules,
  updateSkuConfigRule,
  updateSkuNormalizeRule,
  updateNormalizationRule,
  updateVendorRoutingRule,
};
