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
  semanticLabelKeywords,
  semanticRoles,
} = require('../constants/mappingRule.constants');
const normalizationRepository = require('../repositories/mappingNormalizationRule.repository');
const skuConfigRepository = require('../repositories/mappingSkuConfigRule.repository');
const skuNormalizeRepository = require('../repositories/mappingSkuNormalizeRule.repository');
const routingRepository = require('../repositories/vendorRoutingRule.repository');
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
  return toNormalizationRuleDto(await normalizationRepository.create(normalized));
}

async function updateNormalizationRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const existing = await normalizationRepository.findById(ruleId);
  if (!existing) throw notFound('Normalization rule not found');
  assertRuleWriteAccess(existing.shopId, authContext);
  const updatePatch = omitUndefined(normalizeRulePayload(normalizePatch(patch, [
    'shopId',
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
  assertRuleWriteAccess(updatePatch.shopId === undefined ? existing.shopId : updatePatch.shopId, authContext);
  return toNormalizationRuleDto(await normalizationRepository.update(ruleId, updatePatch));
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
  return toVendorRoutingRuleDto(await routingRepository.create(normalized));
}

async function updateVendorRoutingRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const existing = await routingRepository.findById(ruleId);
  if (!existing) throw notFound('Vendor routing rule not found');
  assertRuleWriteAccess(existing.shopId, authContext);
  const updatePatch = omitUndefined(normalizeRoutingPayload(normalizePatch(patch, [
    'shopId',
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
  assertRuleWriteAccess(updatePatch.shopId === undefined ? existing.shopId : updatePatch.shopId, authContext);
  if (updatePatch.vendorId) await assertActiveVendor(updatePatch.vendorId);
  return toVendorRoutingRuleDto(await routingRepository.update(ruleId, updatePatch));
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
  const items = [];
  for (const rank of ranks) {
    await assertActiveVendor(rank.vendorId);
    items.push(await routingRepository.upsertForScope(scope, {
      vendorId: rank.vendorId,
      priority: rank.priority,
      status: recordStatuses.ACTIVE,
    }));
  }
  return { items: items.sort((a, b) => (a.priority || 100) - (b.priority || 100)).map(toVendorRoutingRuleDto) };
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
    return toSkuConfigRuleDto(await skuConfigRepository.create(normalized));
  } catch (error) {
    await mapDuplicate(error, 'SKU config rule already exists for this scope');
  }
}

async function updateSkuConfigRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const existing = await skuConfigRepository.findById(ruleId);
  if (!existing) throw notFound('SKU config rule not found');
  assertRuleWriteAccess(existing.shopId, authContext);
  const updatePatch = omitUndefined(normalizeSkuConfigPayload(normalizePatch(patch, [
    'shopId',
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
  assertRuleWriteAccess(updatePatch.shopId === undefined ? existing.shopId : updatePatch.shopId, authContext);
  if (updatePatch.productTypeGroupId) await assertActiveProductTypeGroup(updatePatch.productTypeGroupId);
  if (updatePatch.internalTemplateId) await assertActiveInternalTemplate(updatePatch.internalTemplateId);
  try {
    return toSkuConfigRuleDto(await skuConfigRepository.update(ruleId, updatePatch));
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
  return toSkuNormalizeRuleDto(await skuNormalizeRepository.create(normalized));
}

async function updateSkuNormalizeRule(ruleId, patch, authContext = {}) {
  assertValidObjectId(ruleId, 'ruleId');
  const existing = await skuNormalizeRepository.findById(ruleId);
  if (!existing) throw notFound('SKU normalize rule not found');
  assertRuleWriteAccess(existing.shopId, authContext);
  const updatePatch = omitUndefined(normalizeSkuNormalizePayload(normalizePatch(patch, [
    'shopId',
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
  assertRuleWriteAccess(updatePatch.shopId === undefined ? existing.shopId : updatePatch.shopId, authContext);
  return toSkuNormalizeRuleDto(await skuNormalizeRepository.update(ruleId, updatePatch));
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

function assertRuleReadAccess(shopId, authContext = {}) {
  if (shopId) {
    assertCanAccessShop(shopId, MAPPING_READ, authContext);
    return;
  }
  if (!hasGlobalPermission(authContext, MAPPING_READ)) throw forbidden();
}

function visibleToReader(rule, authContext = {}) {
  return !rule.shopId || hasGlobalPermission(authContext, MAPPING_READ)
    || authPublic.canAccessScope(authContext, MAPPING_READ, { scopeType: SHOP_SCOPE_TYPE, scopeId: rule.shopId });
}

function normalizeEvaluationRule(ruleType, rule) {
  if (ruleType === 'skuNormalize') return normalizeSkuNormalizePayload(rule, { defaults: true });
  if (ruleType === 'skuConfig') return normalizeSkuConfigPayload(rule, { defaults: true });
  return normalizeRulePayload({
    ...rule,
    matchTarget: ruleType === 'semanticRules' ? matchTargets.LABEL : matchTargets.VALUE,
  }, { defaults: true });
}

function evaluateSkuNormalizeSample(rule, input) {
  const segments = String(input).split('-');
  const current = segments[rule.segmentIndex];
  const matched = current !== undefined && (rule.appliesWhenValues || [])
    .some((value) => normalizeUpper(value) === normalizeUpper(current));
  if (!matched) return { input, output: input, matched: false };
  if (rule.outputAction === 'REMOVE_SEGMENT') segments.splice(rule.segmentIndex, 1);
  else segments[rule.segmentIndex] = rule.replacementValue;
  return { input, output: segments.join('-'), matched: true };
}

function evaluateRuleSample(ruleType, rule, input) {
  if (ruleType === 'skuNormalize') return evaluateSkuNormalizeSample(rule, input);
  if (ruleType === 'skuConfig') {
    return { input, output: input, matched: normalizeUpper(input) === normalizeUpper(rule.configCode) };
  }
  const matched = ruleMatches(rule, { label: input, value: input });
  return { input, output: matched ? (rule.normalizedValue || input) : input, matched };
}

function sameRulePattern(ruleType, left, right) {
  if (ruleType === 'skuNormalize') {
    return left.patternType === right.patternType
      && left.segmentIndex === right.segmentIndex
      && left.segmentRole === right.segmentRole
      && (left.appliesWhenValues || []).some((value) => (right.appliesWhenValues || [])
        .map(normalizeUpper).includes(normalizeUpper(value)));
  }
  if (ruleType === 'skuConfig') return normalizeUpper(left.configCode) === normalizeUpper(right.configCode);
  return left.semanticRole === right.semanticRole
    && left.matchTarget === right.matchTarget
    && left.matchType === right.matchType
    && lower(left.matchValue) === lower(right.matchValue);
}

function sameRuleScope(left, right) {
  return ['shopId', 'salesChannelCode', 'marketplaceCode', 'productTypeGroupId', 'configCode']
    .every((field) => String(left[field] || '') === String(right[field] || ''));
}

function repositoryForRuleType(ruleType) {
  if (ruleType === 'skuNormalize') return skuNormalizeRepository;
  if (ruleType === 'skuConfig') return skuConfigRepository;
  return normalizationRepository;
}

async function previewRule({ ruleType, rule, samples = [] }, authContext = {}) {
  const normalizedRule = normalizeEvaluationRule(ruleType, rule);
  assertRuleReadAccess(normalizedRule.shopId, authContext);
  return toRulePreviewDto(ruleType, samples.map((input) => evaluateRuleSample(ruleType, normalizedRule, input)));
}

async function findRuleConflicts({ ruleType, rule }, authContext = {}) {
  const normalizedRule = normalizeEvaluationRule(ruleType, rule);
  assertRuleReadAccess(normalizedRule.shopId, authContext);
  const result = await repositoryForRuleType(ruleType).list(scopedQuery({
    status: recordStatuses.ACTIVE,
    limit: 100,
  }, authContext, MAPPING_READ));
  const conflicts = (result.items || [])
    .filter((existing) => visibleToReader(existing, authContext) && sameRulePattern(ruleType, normalizedRule, existing))
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

function roleFromLabel(label) {
  const value = lower(label);
  const matched = Object.entries(semanticLabelKeywords)
    .find(([, keywords]) => keywords.some((keyword) => new RegExp(`\\b${keyword}\\b`).test(value)));
  if (matched) return matched[0];
  return null;
}

function heuristicInputs(input) {
  const parsed = parseDecoratedValue(input.value);
  const label = lower(input.label);

  const isProductColorLabel = semanticLabelKeywords[semanticRoles.PRODUCT_TYPE].some((keyword) => label.includes(keyword))
    && semanticLabelKeywords[semanticRoles.COLOR].some((keyword) => label.includes(keyword));
  if (isProductColorLabel && parsed.value.includes(normalizationSeparators.PRODUCT_COLOR)) {
    const [productType, color] = parsed.value
      .split(normalizationSeparators.PRODUCT_COLOR)
      .map((part) => part.trim())
      .filter(Boolean);
    return [
      {
        semanticRole: semanticRoles.PRODUCT_TYPE,
        value: productType || parsed.value,
        originalLabel: input.label,
        originalValue: input.value,
        confidence: confidenceLevels.HIGH,
        reason: parsed.flags.outOfStock
          ? normalizationReasons.COMBINED_PRODUCT_COLOR_WITH_ANNOTATION
          : normalizationReasons.COMBINED_PRODUCT_COLOR,
        source: inputSources.HEURISTIC,
        ruleId: null,
        annotations: parsed.annotations,
        flags: parsed.flags,
      },
      {
        semanticRole: semanticRoles.COLOR,
        value: color || '',
        originalLabel: input.label,
        originalValue: input.value,
        confidence: confidenceLevels.HIGH,
        reason: parsed.flags.outOfStock
          ? normalizationReasons.COMBINED_PRODUCT_COLOR_WITH_ANNOTATION
          : normalizationReasons.COMBINED_PRODUCT_COLOR,
        source: inputSources.HEURISTIC,
        ruleId: null,
        annotations: parsed.annotations,
        flags: parsed.flags,
      },
    ].filter((item) => item.value);
  }

  const role = roleFromLabel(input.label);
  if (!role) return [];
  const dimensionSize = role === semanticRoles.SIZE && (
    normalizeDimensionSize(parsed.value)
    || parsed.annotations.map(normalizeDimensionSize).find(Boolean)
  );
  return [{
    semanticRole: role,
    value: dimensionSize || parsed.value,
    originalLabel: input.label,
    originalValue: input.value,
    confidence: role === semanticRoles.SIZE || role === semanticRoles.COLOR ? confidenceLevels.HIGH : confidenceLevels.MEDIUM,
    reason: dimensionSize
      ? normalizationReasons.DIMENSION_SIZE_HEURISTIC
      : parsed.flags.outOfStock || parsed.annotations.length
        ? normalizationReasons.LABEL_HEURISTIC_WITH_ANNOTATION
        : normalizationReasons.LABEL_HEURISTIC,
    source: inputSources.HEURISTIC,
    ruleId: null,
    annotations: parsed.annotations,
    flags: parsed.flags,
  }];
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

function combinedBucketInputs(input, roles) {
  const parsed = parseDecoratedValue(input.value);
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
    if (!current || (input.specificity || 0) > (current.specificity || 0)) {
      byRole.set(input.semanticRole, input);
    }
  });
  return [...byRole.values()].map(({ specificity: _specificity, ...input }) => input);
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
      .sort((a, b) => specificity(b, context) - specificity(a, context) || (a.priority || 100) - (b.priority || 100));
    return matched[0] ? [ruleInput(matched[0], input, context)] : [];
  });
  const normalizedInputs = dedupeInputs([
    ...ruleInputs,
    ...skuConfigInputs(rawInputs, parsingConfig),
    ...templateMetadataInputs(rawInputs, internalTemplate),
    ...rawInputs.flatMap(heuristicInputs),
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
  listActiveSkuConfigRulesForContext,
  listActiveSkuNormalizeRulesForContext,
  getNormalizationRule,
  getSkuConfigRule,
  getSkuNormalizeRule,
  getVendorRoutingRule,
  listSkuConfigRules,
  listSkuNormalizeRules,
  listActiveVendorRoutingRulesForContext,
  listNormalizationRules,
  listVendorRoutingRules,
  previewRule,
  reorderVendorRoutingRules,
  updateSkuConfigRule,
  updateSkuNormalizeRule,
  updateNormalizationRule,
  updateVendorRoutingRule,
};
