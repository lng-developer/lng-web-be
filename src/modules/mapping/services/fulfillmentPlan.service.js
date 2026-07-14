const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const customizationPublic = require('../../customization/public');
const orderPublic = require('../../order/public');
const vendorPublic = require('../../vendor/public');
const repository = require('../repositories/fulfillmentPlan.repository');
const {
  costCenterMatchReasons,
  costCenterNormalizationPatterns,
  fulfillmentBlockingReasons,
  fulfillmentCheckStatuses,
  fulfillmentPlanSelectionModes,
  fulfillmentPlanStatuses,
  fulfillmentTimelineEvents,
  fulfillmentTimelineSources,
  productTypeCodeReplacements,
  skuSeparators,
} = require('../constants/fulfillmentPlan.constants');
const {
  confidenceLevels,
  mappingPermissions,
  mappingScopeTypes,
  matchTargets,
  semanticRoles,
  skuNormalizeOutputActions,
  skuNormalizePatternTypes,
  skuNormalizeSegmentRoles,
} = require('../constants/mappingRule.constants');
const {
  compactCostCenter,
  compactListing,
  compactTemplate,
  compactVendorProduct,
  toFulfillmentPlanDto,
  toId,
  toPreviewDto,
} = require('../dtos/fulfillmentPlan.dto');
const mappingRuleService = require('./mappingRule.service');

const MAPPING_READ = mappingPermissions.READ;
const MAPPING_WRITE = mappingPermissions.WRITE;
const SHOP_SCOPE_TYPE = mappingScopeTypes.SHOP;
const PRIORITY_LABEL_TOKENS = Object.freeze(['PRIORITY', 'RUSH', 'EXPEDITE']);
const PRIORITY_POSITIVE_VALUE_PATTERNS = Object.freeze([
  /\bYES\b/,
  /\bRUSH\b/,
  /\bPRIORITY\b/,
  /\bEXPEDITE[D]?\b/,
  /\bI\s+NEED\b/,
]);
const PRIORITY_NEGATIVE_VALUE_PATTERNS = Object.freeze([
  /\bNO\b/,
  /\bNONE\b/,
  /\bFALSE\b/,
  /\bNO\s+THANKS?\b/,
  /\bDO\s+NOT\b/,
  /\bDON'?T\b/,
  /\bNOT\s+NEED\b/,
  /\bDONT\s+NEED\b/,
]);
const RECHECK_BATCH_DEFAULT_LIMIT = 50;
const RECHECK_BATCH_MAX_LIMIT = 100;

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
  if (authContext.system) return true;
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

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasGlobalPermission(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })) {
    throw forbidden();
  }
}

function isReadyPlan(plan) {
  return plan && [fulfillmentPlanStatuses.READY, fulfillmentPlanStatuses.CONFIRMED].includes(plan.status);
}

function recommendedFixTypes(blockingReasons = []) {
  const fixes = new Set();
  blockingReasons.forEach((reason) => {
    if ([fulfillmentBlockingReasons.SKU_CONFIG_AMBIGUOUS, fulfillmentBlockingReasons.LISTING_NOT_FOUND].includes(reason)) {
      fixes.add('SKU_CONFIG');
    }
    if (['TEMPLATE_REQUIRED_INPUT_MISSING', fulfillmentBlockingReasons.CUSTOMIZATION_NOT_READY].includes(reason)) {
      fixes.add('SEMANTIC_RULE');
    }
    if (reason === fulfillmentBlockingReasons.NO_VENDOR_PRODUCT_CANDIDATE) fixes.add('VENDOR_PRODUCT');
    if (reason === fulfillmentBlockingReasons.NO_VENDOR_COST_CENTER_CANDIDATE) {
      fixes.add('VALUE_ALIAS');
      fixes.add('VENDOR_COST_CENTER');
    }
    if (reason === 'SELECTED_OPTION_OUT_OF_STOCK') fixes.add('CUSTOMIZATION_REVIEW');
  });
  return [...fixes];
}

function pushBlock(preview, reason) {
  if (!preview.blockingReasons.includes(reason)) preview.blockingReasons.push(reason);
}

function idEquals(left, right) {
  return toId(left) === toId(right);
}

function itemNeedsCustomization(item) {
  return Boolean(item && item.customizationRawSummary && item.customizationRawSummary.hasCustomization);
}

function parseInternalSku(sku) {
  const parts = String(sku || '').trim().toUpperCase().split(skuSeparators.SEGMENT).filter(Boolean);
  if (parts.length < 4) {
    return {
      employeeCode: null,
      configCode: null,
      dateCode: null,
      sequence: null,
    };
  }
  return {
    employeeCode: parts[0] || null,
    configCode: parts[1] || null,
    dateCode: parts[2] || null,
    sequence: parts.slice(3).join(skuSeparators.SEGMENT) || null,
  };
}

function moneyAmount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function isTwoSidedConfig(configCode) {
  return String(configCode || '').trim().toUpperCase() === 'TS2S';
}

function inputTextValues(customerInputs = {}, normalizedInputs = []) {
  const rawInputs = [
    ...(customerInputs.options || []),
    ...(customerInputs.texts || []),
    ...(customerInputs.images || []),
  ];
  return [
    ...rawInputs.flatMap((input) => [input.label, input.name, input.value]),
    ...normalizedInputs.flatMap((input) => [input.originalLabel, input.originalValue, input.value]),
  ].filter(Boolean).map((value) => String(value).toUpperCase());
}

function hasEmbroiderySignal(customerInputs = {}, normalizedInputs = []) {
  return inputTextValues(customerInputs, normalizedInputs).some((value) => value.includes('EMBROIDERY'));
}

function hasPrioritySignal(item = {}, customerInputs = {}, normalizedInputs = []) {
  if (item.fulfillmentOptions && item.fulfillmentOptions.priorityProduction === true) return true;
  if (item.orderOptions && item.orderOptions.priorityProduction === true) return true;
  const rawInputs = [
    ...(customerInputs.options || []),
    ...(customerInputs.texts || []),
    ...(normalizedInputs || []).map((input) => ({
      label: input.originalLabel,
      name: input.semanticRole,
      value: input.originalValue || input.value,
    })),
  ];

  return rawInputs.some((input) => {
    const label = String(input.label || input.name || '').toUpperCase();
    const value = String(input.value || '').toUpperCase();
    if (!PRIORITY_LABEL_TOKENS.some((token) => label.includes(token))) return false;
    if (PRIORITY_NEGATIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return false;
    return PRIORITY_POSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  });
}

function buildCostEstimate({ costCenter = {}, item = {}, skuMapping = {}, customerInputs = {}, normalizedInputs = [] } = {}) {
  const priority = hasPrioritySignal(item, customerInputs, normalizedInputs);
  const twoSided = isTwoSidedConfig(skuMapping.configCode);
  const embroidery = hasEmbroiderySignal(customerInputs, normalizedInputs);
  const additionalCosts = costCenter.additionalCosts || {};
  const lines = [
    { code: 'BASE_COST', label: 'Base cost', amount: moneyAmount(costCenter.baseCostAmount) },
    { code: 'TWO_SIDED_PRINT', label: 'Two-sided print', amount: twoSided ? moneyAmount(additionalCosts.twoSidedPrintAmount) : 0 },
    { code: 'EMBROIDERY', label: 'Embroidery', amount: embroidery ? moneyAmount(additionalCosts.embroideryAmount) : 0 },
    { code: 'IMPORT_TAX', label: 'Import tax', amount: moneyAmount(costCenter.importTaxAmount) },
    { code: 'EXTRA_FEE', label: 'Extra fee', amount: 0 },
  ];
  return {
    currency: costCenter.currency || 'USD',
    totalAmount: lines.reduce((total, line) => total + line.amount, 0),
    lines,
    signals: {
      configCode: skuMapping.configCode || null,
      twoSided,
      embroidery,
      priority,
    },
  };
}

function applySkuNormalizeRules(sku, rules = []) {
  const originalSku = String(sku || '').trim().toUpperCase();
  const segments = originalSku.split(skuSeparators.SEGMENT).filter(Boolean);
  const removedSegments = [];
  const replacedSegments = [];
  const appliedRuleIds = [];

  rules.forEach((rule) => {
    if (rule.patternType !== skuNormalizePatternTypes.SEGMENT) return;
    if (rule.configCode && String(rule.configCode).trim().toUpperCase() !== (segments[1] || '')) return;
    const index = Number(rule.segmentIndex);
    const value = segments[index];
    const matches = (rule.appliesWhenValues || []).map((item) => String(item || '').trim().toUpperCase());
    if (!value || !matches.includes(value)) return;
    if (rule.outputAction === skuNormalizeOutputActions.REMOVE_SEGMENT) {
      removedSegments.push({ index, value, role: rule.segmentRole || skuNormalizeSegmentRoles.OTHER });
      appliedRuleIds.push(toId(rule));
      segments.splice(index, 1);
      return;
    }
    if (rule.outputAction === skuNormalizeOutputActions.REPLACE_SEGMENT) {
      const replacementValue = String(rule.replacementValue || '').trim().toUpperCase();
      if (!replacementValue || replacementValue === value) return;
      replacedSegments.push({ index, from: value, to: replacementValue, role: rule.segmentRole || skuNormalizeSegmentRoles.OTHER });
      appliedRuleIds.push(toId(rule));
      segments[index] = replacementValue;
    }
  });

  return {
    originalSku,
    canonicalSku: segments.join(skuSeparators.SEGMENT) || originalSku,
    appliedRuleIds,
    removedSegments,
    replacedSegments,
  };
}

function templateNeedsCustomization(template) {
  return Boolean(template && Array.isArray(template.requiredFields) && template.requiredFields.some((field) => field.required));
}

function termsFromItem(item, normalizedInputs = []) {
  const variant = item.variantRaw || {};
  const byRole = normalizedInputs.reduce((result, input) => {
    result[input.semanticRole] = input.value;
    return result;
  }, {});
  return {
    sku: item.sku && String(item.sku).trim().toUpperCase(),
    size: normalizeCostCenterValue(byRole.SIZE || variant.standardSize || variant.size || variant.Size),
    color: normalizeCostCenterValue(byRole.COLOR || variant.standardColor || variant.color || variant.Color),
  };
}

function normalizeCostCenterValue(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  const withoutUnits = raw
    .replace(costCenterNormalizationPatterns.DIMENSION_UNITS, ' ')
    .replace(costCenterNormalizationPatterns.DIMENSION_MULTIPLY, 'X')
    .replace(costCenterNormalizationPatterns.WHITESPACE, ' ')
    .trim();
  const packMatch = withoutUnits.match(costCenterNormalizationPatterns.PACK_PCS);
  if (packMatch) return `${packMatch[1]} PCS`;
  const pcsMatch = withoutUnits.match(costCenterNormalizationPatterns.PCS);
  if (pcsMatch) return `${pcsMatch[1]} PCS`;
  return withoutUnits
    .replace(costCenterNormalizationPatterns.NON_ALNUM_DECIMAL, '')
    .trim();
}

function scoreCostCenter(costCenter, item, normalizedInputs = []) {
  const terms = termsFromItem(item, normalizedInputs);
  let score = 0;
  let matchTier = 0;
  const matchReasons = [];
  if (terms.sku && String(costCenter.sku || '').toUpperCase() === terms.sku) {
    score += 100;
    matchTier = Math.max(matchTier, 4);
    matchReasons.push(costCenterMatchReasons.SKU_EXACT);
  }
  if (terms.sku && String(costCenter.lngCode || '').toUpperCase() === terms.sku) {
    score += 95;
    matchTier = Math.max(matchTier, 4);
    matchReasons.push(costCenterMatchReasons.LNG_CODE_EXACT);
  }
  const standardSizeMatch = terms.size && normalizeCostCenterValue(costCenter.standardSize) === terms.size;
  const standardColorMatch = terms.color && normalizeCostCenterValue(costCenter.standardColor) === terms.color;
  const vendorSizeMatch = terms.size && normalizeCostCenterValue(costCenter.vendorSize) === terms.size;
  const vendorColorMatch = terms.color && normalizeCostCenterValue(costCenter.vendorColor) === terms.color;
  const attributes = costCenter.attributes || {};
  const attrSizeMatch = terms.size && normalizeCostCenterValue(attributes.size) === terms.size;
  const attrColorMatch = terms.color && normalizeCostCenterValue(attributes.color) === terms.color;
  if (standardSizeMatch) {
    score += 40;
    matchReasons.push(costCenterMatchReasons.STANDARD_SIZE);
  }
  if (standardColorMatch) {
    score += 40;
    matchReasons.push(costCenterMatchReasons.STANDARD_COLOR);
  }
  if ((terms.size || terms.color) && (!terms.size || standardSizeMatch) && (!terms.color || standardColorMatch)) {
    matchTier = Math.max(matchTier, 3);
  }
  if (vendorSizeMatch) {
    score += 30;
    matchReasons.push(costCenterMatchReasons.VENDOR_SIZE);
  }
  if (vendorColorMatch) {
    score += 30;
    matchReasons.push(costCenterMatchReasons.VENDOR_COLOR);
  }
  if ((terms.size || terms.color) && (!terms.size || vendorSizeMatch) && (!terms.color || vendorColorMatch)) {
    matchTier = Math.max(matchTier, 2);
  }
  if (attrSizeMatch) {
    score += 20;
    matchReasons.push(costCenterMatchReasons.ATTR_SIZE);
  }
  if (attrColorMatch) {
    score += 20;
    matchReasons.push(costCenterMatchReasons.ATTR_COLOR);
  }
  if ((terms.size || terms.color) && (!terms.size || attrSizeMatch) && (!terms.color || attrColorMatch)) {
    matchTier = Math.max(matchTier, 1);
  }
  const confidence = score >= 80 ? confidenceLevels.HIGH : score >= 40 ? confidenceLevels.MEDIUM : confidenceLevels.LOW;
  return { score, matchReasons, confidence, matchTier };
}

async function loadOrderItem(orderItemId) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) throw notFound('Order item not found');
  return item;
}

function emptyPreview(orderItemId) {
  return {
    orderItemId,
    orderId: null,
    ready: false,
    selectedVendorProductId: null,
    selectedVendorCostCenterId: null,
    checks: {
      listing: { ok: false, status: fulfillmentCheckStatuses.NOT_CHECKED },
      internalTemplate: { ok: false, status: fulfillmentCheckStatuses.NOT_CHECKED },
      customization: { ok: false, status: fulfillmentCheckStatuses.NOT_CHECKED },
      vendorProducts: { ok: false, count: 0 },
      costCenters: { ok: false, count: 0 },
    },
    blockingReasons: [fulfillmentBlockingReasons.ORDER_ITEM_NOT_FOUND],
    listing: null,
    internalTemplate: null,
    vendorProductCandidates: [],
    costCenterCandidates: [],
    item: null,
  };
}

async function getCustomizationCheck(item, template) {
  if (!itemNeedsCustomization(item) && !templateNeedsCustomization(template)) {
    return { ok: true, status: fulfillmentCheckStatuses.NOT_REQUIRED };
  }

  try {
    const payload = await customizationPublic.assertCustomizationReady(item._id || item.id);
    return { ok: true, status: payload.status || fulfillmentCheckStatuses.READY };
  } catch (error) {
    return { ok: false, status: fulfillmentCheckStatuses.NOT_READY };
  }
}

async function getCustomerInputs(item) {
  if (typeof customizationPublic.getOrderItemCustomizationView !== 'function') return {};
  try {
    const view = await customizationPublic.getOrderItemCustomizationView(item._id || item.id);
    return view && view.customerInputs ? view.customerInputs : {};
  } catch (_error) {
    return {};
  }
}

function routingRank(product, routingRules = []) {
  const vendorId = toId(product.vendorId);
  const matched = routingRules.filter((rule) => toId(rule.vendorId) === vendorId);
  if (!matched.length) return { specificity: 0, priority: 999999 };
  const best = matched[0];
  return { specificity: best.specificity || 0, priority: best.priority || 100 };
}

function sortCostCenters(left, right) {
  return (
    (right.matchTier || 0) - (left.matchTier || 0)
    || (right.routingSpecificity || 0) - (left.routingSpecificity || 0)
    || (left.routingPriority || 999999) - (right.routingPriority || 999999)
    || (right.matchScore || 0) - (left.matchScore || 0)
    || (left.baseCostAmount ?? 999999999) - (right.baseCostAmount ?? 999999999)
    || String(left._id || left.id).localeCompare(String(right._id || right.id))
  );
}

function buildAutoMatch(preview) {
  if (preview.blockingReasons.length > 0) return null;
  const [top] = preview.costCenterCandidates;
  if (!top || top.confidence !== confidenceLevels.HIGH) return null;
  const tied = preview.costCenterCandidates.filter((candidate) => (
    (candidate.routingSpecificity || 0) === (top.routingSpecificity || 0)
    && (candidate.routingPriority || 999999) === (top.routingPriority || 999999)
    && candidate.confidence === top.confidence
    && (candidate.matchTier || 0) === (top.matchTier || 0)
    && (candidate.matchScore || 0) === (top.matchScore || 0)
    && (candidate.baseCostAmount ?? 999999999) === (top.baseCostAmount ?? 999999999)
  ));
  if (tied.length !== 1) return null;
  return {
    vendorProductId: toId(top.vendorProductId),
    vendorCostCenterId: toId(top),
    confidence: top.confidence,
    score: top.matchScore || 0,
    matchReasons: top.matchReasons || [],
    costEstimate: top.costEstimate || null,
  };
}

function firstNormalizedValue(normalizedInputs = [], role) {
  const input = normalizedInputs.find((entry) => entry.semanticRole === role && entry.value);
  return input ? input.value : null;
}

function compactVendor(value) {
  if (!value) return null;
  return {
    id: toId(value._id || value.id),
    code: value.code || null,
    name: value.name || null,
  };
}

function toSearchCostCenter(costCenter = {}) {
  return {
    id: toId(costCenter._id || costCenter.id),
    vendorProductId: toId(costCenter.vendorProductId),
    code: costCenter.code || null,
    name: costCenter.name || null,
    sku: costCenter.sku || null,
    lngCode: costCenter.lngCode || null,
    vendorSize: costCenter.vendorSize || null,
    vendorColor: costCenter.vendorColor || null,
    standardSize: costCenter.standardSize || null,
    standardColor: costCenter.standardColor || null,
    baseCostAmount: costCenter.baseCostAmount ?? null,
    currency: costCenter.currency || null,
  };
}

function toSearchProduct(product = {}) {
  if (!product) return null;
  return {
    id: toId(product._id || product.id),
    code: product.code || null,
    name: product.name || null,
    productTypeGroupId: toId(product.productTypeGroupId),
  };
}

async function searchVendorCandidatesForOrderItem(orderItemId, query = {}, authContext) {
  const item = await loadOrderItem(orderItemId);
  assertCanAccessShop(item.shopId, MAPPING_READ, authContext);

  const customerInputs = await getCustomerInputs(item, authContext);
  const normalized = await mappingRuleService.buildNormalizedInputs({
    context: {
      shopId: item.shopId,
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
    },
    customerInputs,
    internalTemplate: {},
  });
  const normalizedInputs = normalized.normalizedInputs || [];
  const size = query.size || firstNormalizedValue(normalizedInputs, semanticRoles.SIZE);
  const color = query.color || firstNormalizedValue(normalizedInputs, semanticRoles.COLOR);
  const scoringInputs = [
    ...(size ? [{
      semanticRole: semanticRoles.SIZE,
      value: normalizeCostCenterValue(size),
      originalLabel: query.size ? 'Manual size' : null,
      originalValue: size,
      confidence: confidenceLevels.HIGH,
      reason: query.size ? 'MANUAL_SEARCH_FILTER' : 'NORMALIZED_INPUT',
      source: query.size ? 'MANUAL' : 'RULE',
    }] : []),
    ...(color ? [{
      semanticRole: semanticRoles.COLOR,
      value: normalizeCostCenterValue(color),
      originalLabel: query.color ? 'Manual color' : null,
      originalValue: color,
      confidence: confidenceLevels.HIGH,
      reason: query.color ? 'MANUAL_SEARCH_FILTER' : 'NORMALIZED_INPUT',
      source: query.color ? 'MANUAL' : 'RULE',
    }] : []),
  ];

  const result = await vendorPublic.searchVendorCostCenters({
    q: query.q || undefined,
    vendorId: query.vendorId || undefined,
    vendorProductId: query.vendorProductId || undefined,
    productTypeGroupId: query.productTypeGroupId || undefined,
    size: size || undefined,
    color: color || undefined,
    sku: query.sku || undefined,
    lngCode: query.lngCode || undefined,
    includeDifferentProductType: Boolean(query.includeDifferentProductType),
    page: query.page || 1,
    limit: query.limit || 20,
  });

  const rows = (result.items || []).map((row) => {
    const costCenter = row.vendorCostCenter || {};
    const scored = scoreCostCenter(costCenter, item, scoringInputs);
    return {
      vendor: compactVendor(row.vendor),
      vendorProduct: toSearchProduct(row.vendorProduct),
      vendorCostCenter: toSearchCostCenter(costCenter),
      match: {
        score: scored.score,
        confidence: scored.confidence,
        reasons: scored.matchReasons,
      },
    };
  });

  rows.sort((left, right) => (
    (right.match.score || 0) - (left.match.score || 0)
    || (left.vendorCostCenter.baseCostAmount ?? 999999999) - (right.vendorCostCenter.baseCostAmount ?? 999999999)
    || String(left.vendorCostCenter.id).localeCompare(String(right.vendorCostCenter.id))
  ));

  return {
    orderItemId: toId(item),
    signals: {
      sku: item.sku || null,
      productTypeGroupId: toId(query.productTypeGroupId),
      normalizedSize: size ? normalizeCostCenterValue(size) : null,
      normalizedColor: color ? normalizeCostCenterValue(color) : null,
    },
    items: rows,
    pagination: result.pagination || { total: rows.length, page: query.page || 1, limit: query.limit || 20 },
  };
}

function productTypeCodeFromValue(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function productTypeCodeCandidates(value) {
  const base = productTypeCodeFromValue(value);
  if (!base) return [];
  const candidates = new Set([base]);
  productTypeCodeReplacements.forEach(([from, to]) => {
    candidates.add(base.replace(new RegExp(from, 'g'), to));
  });
  return [...candidates].filter(Boolean);
}

async function resolveSelectedProductTypeGroupId(normalizedInputs = [], fallbackProductTypeGroupId) {
  const selectedProductType = normalizedInputs.find((input) => input.semanticRole === semanticRoles.PRODUCT_TYPE && input.value);
  if (!selectedProductType || typeof catalogPublic.findProductTypeGroupByCode !== 'function') {
    return fallbackProductTypeGroupId;
  }
  for (const groupCode of productTypeCodeCandidates(selectedProductType.value)) {
    const group = await catalogPublic.findProductTypeGroupByCode(groupCode);
    if (group && (group._id || group.id)) return toId(group);
  }
  return fallbackProductTypeGroupId;
}

function productTypeSignals(normalizedInputs = []) {
  return normalizedInputs
    .filter((input) => input.semanticRole === semanticRoles.PRODUCT_TYPE && input.value)
    .flatMap((input) => [String(input.value).trim().toUpperCase(), productTypeCodeFromValue(input.value)])
    .filter(Boolean);
}

function ruleAliases(rule = {}) {
  return [
    ...(rule.productTypeAliases || []),
    rule.platformProductType,
  ].flatMap((value) => [String(value || '').trim().toUpperCase(), productTypeCodeFromValue(value)])
    .filter(Boolean);
}

function selectSkuConfigRule(rules = [], normalizedInputs = []) {
  if (!rules.length) return { rule: null, ambiguous: false, matchedAlias: null };
  if (rules.length === 1) return { rule: rules[0], ambiguous: false, matchedAlias: null };
  const signals = new Set(productTypeSignals(normalizedInputs));
  if (!signals.size) return { rule: null, ambiguous: true, matchedAlias: null };
  const matches = rules.map((rule) => {
    const matchedAlias = ruleAliases(rule).find((alias) => signals.has(alias));
    return matchedAlias ? { rule, matchedAlias } : null;
  }).filter(Boolean);
  if (matches.length !== 1) return { rule: null, ambiguous: true, matchedAlias: null };
  return { rule: matches[0].rule, ambiguous: false, matchedAlias: matches[0].matchedAlias };
}

function mergeSkuParsingConfig(rules = []) {
  const mergeArray = (field) => [...new Set(rules.flatMap((rule) => rule[field] || []).filter(Boolean))];
  return {
    sizeKeys: mergeArray('sizeKeys'),
    colorKeys: mergeArray('colorKeys'),
    productTypeKeys: mergeArray('productTypeKeys'),
    productTypeColorKeys: mergeArray('productTypeColorKeys'),
    productTypeSizeKeys: mergeArray('productTypeSizeKeys'),
    combinationKeys: mergeArray('combinationKeys'),
  };
}

async function buildPreview(orderItemId, authContext, options = {}) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderPublic.findItemById(orderItemId);
  if (!item) return emptyPreview(orderItemId);
  assertCanAccessShop(item.shopId, options.createMissingListing ? MAPPING_WRITE : MAPPING_READ, authContext);

  const preview = {
    orderItemId: item._id || item.id,
    orderId: item.orderId,
    ready: false,
    selectedVendorProductId: null,
    selectedVendorCostCenterId: null,
    checks: {
      listing: { ok: false, status: fulfillmentCheckStatuses.MISSING },
      internalTemplate: { ok: false, status: fulfillmentCheckStatuses.MISSING },
      customization: { ok: false, status: fulfillmentCheckStatuses.NOT_CHECKED },
      vendorProducts: { ok: false, count: 0 },
      costCenters: { ok: false, count: 0 },
    },
    blockingReasons: [],
    listing: null,
    internalTemplate: null,
    productTypeGroupId: null,
    skuNormalization: null,
    skuMapping: null,
    normalizedInputs: [],
    customerInputs: {},
    autoMatch: null,
    vendorProductCandidates: [],
    costCenterCandidates: [],
    item,
  };

  const rawParsedSku = parseInternalSku(item.sku);
  const skuNormalizeRules = await mappingRuleService.listActiveSkuNormalizeRulesForContext({
    shopId: toId(item.shopId),
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    configCode: rawParsedSku.configCode,
  });
  preview.skuNormalization = applySkuNormalizeRules(item.sku, skuNormalizeRules);
  const effectiveItem = { ...item, sku: preview.skuNormalization.canonicalSku };

  const findListingForOrderItem = catalogPublic.findListingForOrderItem || catalogPublic.findListingBySku;
  let listing = await findListingForOrderItem({
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    asin: item.asin,
    sku: preview.skuNormalization.canonicalSku,
    fallbackSku: preview.skuNormalization.originalSku,
  });
  if (!listing && preview.skuNormalization.canonicalSku !== preview.skuNormalization.originalSku) {
    listing = await findListingForOrderItem({
      shopId: item.shopId,
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      asin: item.asin,
      sku: preview.skuNormalization.originalSku,
    });
  }

  const parsedSku = parseInternalSku(preview.skuNormalization.canonicalSku);
  const skuRules = parsedSku.configCode
    ? await mappingRuleService.listActiveSkuConfigRulesForContext({
      shopId: toId(item.shopId),
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      configCode: parsedSku.configCode,
    })
    : [];

  if (listing) {
    preview.listing = listing;
    preview.checks.listing = { ok: true, status: fulfillmentCheckStatuses.FOUND };
  }

  let listingProductTypeGroupId = listing && listing.productTypeGroupId && toId(listing.productTypeGroupId);
  let listingTemplate = listing ? await catalogPublic.getInternalTemplateForListing(listing._id || listing.id) : null;
  const customerInputs = await getCustomerInputs(item, authContext);
  preview.customerInputs = customerInputs;
  const normalized = await mappingRuleService.buildNormalizedInputs({
    context: {
      shopId: toId(item.shopId),
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      productTypeGroupId: listingProductTypeGroupId || null,
    },
    customerInputs,
    internalTemplate: listingTemplate || {},
    parsingConfig: mergeSkuParsingConfig(skuRules),
  });
  preview.normalizedInputs = normalized.normalizedInputs || [];
  (normalized.blockingReasons || []).forEach((reason) => pushBlock(preview, reason));
  const selectedSkuRule = selectSkuConfigRule(skuRules, preview.normalizedInputs);
  const skuRule = selectedSkuRule.rule;
  preview.skuMapping = {
    ...parsedSku,
    ruleId: skuRule ? toId(skuRule) : null,
    productTypeGroupId: skuRule ? toId(skuRule.productTypeGroupId) : null,
    internalTemplateId: skuRule ? toId(skuRule.internalTemplateId) : null,
    matchedAlias: selectedSkuRule.matchedAlias,
    ambiguous: selectedSkuRule.ambiguous,
  };
  if (preview.skuMapping.ambiguous) pushBlock(preview, fulfillmentBlockingReasons.SKU_CONFIG_AMBIGUOUS);

  const selectedProductTypeGroupId = preview.skuMapping.productTypeGroupId
    ? preview.skuMapping.productTypeGroupId
    : await resolveSelectedProductTypeGroupId(preview.normalizedInputs, listingProductTypeGroupId);
  preview.productTypeGroupId = selectedProductTypeGroupId;

  if (!selectedProductTypeGroupId) {
    pushBlock(preview, fulfillmentBlockingReasons.LISTING_NOT_FOUND);
    return preview;
  }

  if (!listing && options.createMissingListing && !preview.skuMapping.ambiguous) {
    listing = await catalogPublic.findOrCreateListingForOrderItem({
      shopId: item.shopId,
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      asin: item.asin,
      sku: preview.skuNormalization.canonicalSku,
      fallbackSku: preview.skuNormalization.originalSku,
      title: item.title,
      productTypeGroupId: selectedProductTypeGroupId,
      internalTemplateId: preview.skuMapping.internalTemplateId || null,
      currency: item.price?.currency || item.currency || null,
    }, authContext);
    if (listing) {
      preview.listing = listing;
      preview.checks.listing = { ok: true, status: fulfillmentCheckStatuses.FOUND };
      listingProductTypeGroupId = listing.productTypeGroupId && toId(listing.productTypeGroupId);
      listingTemplate = listing.internalTemplateId
        ? await catalogPublic.getInternalTemplateForListing(listing._id || listing.id)
        : null;
    }
  }

  if (options.createMissingListing && listing) {
    const listingId = toId(listing._id || listing.id);
    if (listingId && String(item.listingId || '') !== listingId && typeof orderPublic.updateItemListingId === 'function') {
      await orderPublic.updateItemListingId(orderItemId, listingId);
    }
    await triggerPsdDesignTaskForMissingListing(listing, authContext);
  }

  const internalTemplate = preview.skuMapping.internalTemplateId
    ? await catalogPublic.getInternalTemplateById(preview.skuMapping.internalTemplateId)
    : listingTemplate;
  if (internalTemplate) {
    preview.internalTemplate = internalTemplate;
    preview.checks.internalTemplate = { ok: true, status: fulfillmentCheckStatuses.FOUND };
  }

  const customization = await getCustomizationCheck(item, internalTemplate);
  preview.checks.customization = customization;
  if (!customization.ok) pushBlock(preview, fulfillmentBlockingReasons.CUSTOMIZATION_NOT_READY);

  const vendorProducts = await vendorPublic.listActiveVendorProductsByProductTypeGroup(selectedProductTypeGroupId);
  preview.vendorProductCandidates = vendorProducts || [];
  preview.checks.vendorProducts = { ok: preview.vendorProductCandidates.length > 0, count: preview.vendorProductCandidates.length };
  if (preview.vendorProductCandidates.length === 0) pushBlock(preview, fulfillmentBlockingReasons.NO_VENDOR_PRODUCT_CANDIDATE);

  const routingTerms = termsFromItem(effectiveItem, preview.normalizedInputs);
  const routingRules = await mappingRuleService.listActiveVendorRoutingRulesForContext({
    shopId: toId(item.shopId),
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    productTypeGroupId: selectedProductTypeGroupId,
    asin: item.asin || null,
    configCode: preview.skuMapping.configCode || null,
    normalizedSize: routingTerms.size || null,
    normalizedColor: routingTerms.color || null,
  });

  const costCentersByProduct = await Promise.all(preview.vendorProductCandidates.map(async (product) => {
    const route = routingRank(product, routingRules);
    const rows = await vendorPublic.listActiveVendorCostCenters(product._id || product.id);
    return (rows || []).map((row) => ({
      ...row,
      vendorProductId: row.vendorProductId || product._id || product.id,
      routingSpecificity: route.specificity,
      routingPriority: route.priority,
      ...(() => {
        const scored = scoreCostCenter(row, effectiveItem, preview.normalizedInputs);
        return {
          matchScore: scored.score,
          matchReasons: scored.matchReasons,
          confidence: scored.confidence,
          matchTier: scored.matchTier,
        };
      })(),
      costEstimate: buildCostEstimate({
        costCenter: row,
        item: effectiveItem,
        skuMapping: preview.skuMapping,
        customerInputs: preview.customerInputs,
        normalizedInputs: preview.normalizedInputs,
      }),
    }));
  }));
  preview.costCenterCandidates = costCentersByProduct.flat().sort(sortCostCenters);
  preview.checks.costCenters = { ok: preview.costCenterCandidates.length > 0, count: preview.costCenterCandidates.length };
  if (preview.costCenterCandidates.length === 0) pushBlock(preview, fulfillmentBlockingReasons.NO_VENDOR_COST_CENTER_CANDIDATE);

  preview.ready = preview.blockingReasons.length === 0;
  preview.autoMatch = buildAutoMatch(preview);
  return preview;
}

async function previewFulfillmentPlan(orderItemId, options = {}, authContext) {
  return toPreviewDto(await buildPreview(orderItemId, authContext));
}

function ruleQueryFrom(query = {}) {
  return {
    shopId: query.shopId,
    salesChannelCode: query.salesChannelCode,
    marketplaceCode: query.marketplaceCode,
    configCode: query.configCode,
    productTypeGroupId: query.productTypeGroupId,
    page: 1,
    limit: 20,
  };
}

function emptyOrderItemPage(page = 1, limit = 20) {
  return { items: [], pagination: { total: 0, page, limit } };
}

async function listOrderItemsForMapping(query = {}, authContext = {}, permission = MAPPING_READ) {
  const limit = Math.min(Number(query.limit) || RECHECK_BATCH_DEFAULT_LIMIT, RECHECK_BATCH_MAX_LIMIT);
  const itemQuery = {
    shopId: query.shopId,
    salesChannelCode: query.salesChannelCode,
    marketplaceCode: query.marketplaceCode,
    status: query.status,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    page: 1,
    limit,
  };

  if (itemQuery.shopId) {
    assertCanAccessShop(itemQuery.shopId, permission, authContext);
    return orderPublic.listItems(itemQuery);
  }

  if (hasGlobalPermission(authContext, permission)) return orderPublic.listItems(itemQuery);

  const shopIds = getScopedShopIds(authContext, permission);
  if (!shopIds.length) return emptyOrderItemPage(1, limit);
  return orderPublic.listItems({ ...itemQuery, shopIds });
}

function toUnmatchedSample(preview) {
  return {
    orderItemId: toId(preview.orderItemId),
    sku: preview.item ? preview.item.sku || null : null,
    blockingReasons: preview.blockingReasons || [],
    skuNormalization: preview.skuNormalization || null,
    skuMapping: preview.skuMapping || null,
    normalizedInputs: preview.normalizedInputs || [],
    recommendedFixTypes: recommendedFixTypes(preview.blockingReasons || []),
  };
}

async function getMappingConfigWorkbench(query = {}, authContext = {}) {
  const sampleLimit = Math.min(Number(query.sampleLimit) || 10, 50);
  const ruleQuery = ruleQueryFrom(query);
  const [
    skuConfigRules,
    skuNormalizeRules,
    semanticRules,
    valueAliases,
    vendorRoutingRules,
    orderItems,
  ] = await Promise.all([
    mappingRuleService.listSkuConfigRules(ruleQuery, authContext),
    mappingRuleService.listSkuNormalizeRules(ruleQuery, authContext),
    mappingRuleService.listNormalizationRules({ ...ruleQuery, matchTarget: matchTargets.LABEL }, authContext),
    mappingRuleService.listNormalizationRules({ ...ruleQuery, matchTarget: matchTargets.VALUE, hasNormalizedValue: true }, authContext),
    mappingRuleService.listVendorRoutingRules(ruleQuery, authContext),
    listOrderItemsForMapping({ ...query, limit: sampleLimit }, authContext, MAPPING_READ),
  ]);

  const unmatchedSamples = [];
  for (const item of orderItems.items || []) {
    if (unmatchedSamples.length >= sampleLimit) break;
    const existing = await repository.findByOrderItem(item._id || item.id);
    if (isReadyPlan(existing)) continue;
    const preview = await buildPreview(item._id || item.id, authContext);
    if (!preview.ready) unmatchedSamples.push(toUnmatchedSample(preview));
  }

  return {
    ruleCounts: {
      skuConfigRules: skuConfigRules.pagination?.total || 0,
      skuNormalizeRules: skuNormalizeRules.pagination?.total || 0,
      semanticRules: semanticRules.pagination?.total || 0,
      valueAliases: valueAliases.pagination?.total || 0,
      vendorRoutingRules: vendorRoutingRules.pagination?.total || 0,
    },
    rules: {
      skuConfigRules,
      skuNormalizeRules,
      semanticRules,
      valueAliases,
      vendorRoutingRules,
    },
    unmatchedSamples,
  };
}

function assertSelectionPayload(payload = {}) {
  if (!payload.vendorProductId) throw validationError('vendorProductId is required', { field: 'vendorProductId' });
  if (!payload.vendorCostCenterId) throw validationError('vendorCostCenterId is required', { field: 'vendorCostCenterId' });
  assertValidObjectId(payload.vendorProductId, 'vendorProductId');
  assertValidObjectId(payload.vendorCostCenterId, 'vendorCostCenterId');
}

function snapshotFrom({
  preview, vendorProduct, costCenter, vendor,
}) {
  const vendorProductSnapshotSource = vendorProduct ? {
    ...vendorProduct,
    vendor: vendor || vendorProduct.vendor || vendorProduct.vendorId || null,
  } : null;
  const costCenterSnapshotSource = costCenter ? {
    ...costCenter,
    vendor: vendor || costCenter.vendor || costCenter.vendorId || null,
  } : null;
  return {
    orderItem: {
      id: toId(preview.item),
      externalOrderId: preview.item.externalOrderId || null,
      externalItemId: preview.item.externalItemId || null,
      sku: preview.item.sku || null,
      title: preview.item.title || null,
      quantity: preview.item.quantity || null,
    },
    listing: compactListing(preview.listing),
    internalTemplate: compactTemplate(preview.internalTemplate),
    vendorProduct: compactVendorProduct(vendorProductSnapshotSource),
    vendorCostCenter: compactCostCenter(costCenterSnapshotSource),
    costEstimate: buildCostEstimate({
      costCenter,
      item: preview.item,
      skuMapping: preview.skuMapping,
      customerInputs: preview.customerInputs,
      normalizedInputs: preview.normalizedInputs,
    }),
  };
}

async function triggerProductionTaskForReadyPlan(orderItemId, plan, authContext) {
  try {
    // ponytail: inline trigger is enough for V1; move to a queue if this becomes slow or needs retries.
    const productionPublic = require('../../production/public');
    if (typeof productionPublic.createOrRecheckTaskForOrderItem === 'function') {
      await productionPublic.createOrRecheckTaskForOrderItem(orderItemId, {
        ...(authContext || {}),
        system: true,
        source: 'MAPPING',
      });
    }
  } catch (error) {
    logger.warn('Auto production task trigger skipped', {
      orderItemId,
      fulfillmentPlanId: toId(plan),
      error,
    });
  }
}

async function triggerPsdDesignTaskForMissingListing(listing, authContext) {
  const listingId = toId(listing && (listing._id || listing.id));
  if (!listingId || listing.psdStatus !== 'MISSING') return;

  try {
    const designPublic = require('../../design/public');
    if (typeof designPublic.createPsdTemplateTaskFromListing === 'function') {
      await designPublic.createPsdTemplateTaskFromListing(listingId, {
        note: 'Auto-created from mapping missing PSD listing',
      }, {
        ...(authContext || {}),
        system: true,
        source: 'MAPPING',
      });
    }
  } catch (error) {
    logger.warn('Auto PSD design task trigger skipped from mapping', {
      listingId,
      error,
    });
  }
}

async function persistReadyPlan(orderItemId, payload = {}, authContext, selectionMode, options = {}) {
  assertSelectionPayload(payload);
  const preview = options.preview || await buildPreview(orderItemId, authContext, options);
  if (!preview.item) {
    throw conflict('Fulfillment plan is blocked', toPreviewDto(preview));
  }
  assertCanAccessShop(preview.item.shopId, MAPPING_WRITE, authContext);

  const existingPlan = await repository.findByOrderItem(orderItemId);
  if (existingPlan && [fulfillmentPlanStatuses.READY, fulfillmentPlanStatuses.CONFIRMED].includes(existingPlan.status)) {
    const sameSelection = idEquals(existingPlan.vendorProductId, payload.vendorProductId)
      && idEquals(existingPlan.vendorCostCenterId, payload.vendorCostCenterId);
    if (sameSelection) return toFulfillmentPlanDto(existingPlan);
    throw conflict('Plan already resolved', { blockingReasons: [fulfillmentBlockingReasons.PLAN_ALREADY_RESOLVED] });
  }

  if (!preview.ready) {
    throw conflict('Fulfillment plan is blocked', toPreviewDto(preview));
  }

  const vendorProduct = await vendorPublic.getVendorProductById(payload.vendorProductId);
  if (!vendorProduct) {
    throw conflict('Selected vendor product is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_PRODUCT_INVALID] });
  }
  const vendor = await vendorPublic.getVendorById(toId(vendorProduct.vendorId));
  if (!vendor) {
    throw conflict('Selected vendor product is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_PRODUCT_INVALID] });
  }
  if (!idEquals(vendorProduct.productTypeGroupId, preview.productTypeGroupId || preview.listing.productTypeGroupId)) {
    throw conflict('Selected vendor product is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_PRODUCT_INVALID] });
  }

  const activeCostCenters = await vendorPublic.listActiveVendorCostCenters(payload.vendorProductId);
  const costCenter = (activeCostCenters || []).find((candidate) => idEquals(candidate, payload.vendorCostCenterId));
  if (!costCenter) {
    throw conflict('Selected vendor cost center is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_COST_CENTER_INVALID] });
  }
  if (!idEquals(costCenter.vendorProductId, payload.vendorProductId) || !idEquals(costCenter.vendorId, vendorProduct.vendorId)) {
    throw conflict('Selected vendor cost center is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_COST_CENTER_INVALID] });
  }

  const resolvedAt = new Date();
  const plan = await repository.upsertByOrderItem(orderItemId, {
    orderId: preview.item.orderId,
    orderItemId,
    shopId: preview.item.shopId,
    salesChannelCode: preview.item.salesChannelCode,
    marketplaceCode: preview.item.marketplaceCode,
    listingId: preview.listing ? (preview.listing._id || preview.listing.id) : null,
    internalTemplateId: preview.internalTemplate ? (preview.internalTemplate._id || preview.internalTemplate.id) : null,
    productTypeGroupId: preview.productTypeGroupId || preview.listing.productTypeGroupId,
    vendorProductId: payload.vendorProductId,
    vendorCostCenterId: payload.vendorCostCenterId,
    status: fulfillmentPlanStatuses.READY,
    selectionMode,
    blockingReasons: [],
    checks: preview.checks,
    snapshot: snapshotFrom({
      preview, vendorProduct, costCenter, vendor,
    }),
    resolvedBy: authContext && authContext.accountId ? authContext.accountId : null,
    resolvedAt,
  });

  await orderPublic.updateCostCenterStatusForOrder(preview.item.orderId);
  await orderPublic.updatePsdStatusForOrder(preview.item.orderId);

  await orderPublic.appendTimeline({
    orderId: preview.item.orderId,
    orderItemId,
    shopId: preview.item.shopId,
    salesChannelCode: preview.item.salesChannelCode,
    marketplaceCode: preview.item.marketplaceCode,
    eventType: fulfillmentTimelineEvents.PLAN_READY,
    source: fulfillmentTimelineSources.MAPPING,
  });

  await triggerProductionTaskForReadyPlan(orderItemId, plan, authContext);

  return toFulfillmentPlanDto(plan);
}

async function selectFulfillmentPlan(orderItemId, payload = {}, authContext) {
  return persistReadyPlan(orderItemId, payload, authContext, fulfillmentPlanSelectionModes.MANUAL);
}

async function resolveFulfillmentPlan(orderItemId, options = {}, authContext) {
  const preview = await buildPreview(orderItemId, authContext, { ...options, createMissingListing: true });
  if (!preview.item) return toPreviewDto(preview);
  assertCanAccessShop(preview.item.shopId, MAPPING_WRITE, authContext);
  if (!preview.ready || !preview.autoMatch) return toPreviewDto(preview);
  return persistReadyPlan(orderItemId, {
    vendorProductId: preview.autoMatch.vendorProductId,
    vendorCostCenterId: preview.autoMatch.vendorCostCenterId,
  }, authContext, fulfillmentPlanSelectionModes.AUTO, { ...options, createMissingListing: true, preview });
}

async function recheckFulfillmentPlan(orderItemId, options = {}, authContext) {
  return resolveFulfillmentPlan(orderItemId, options, authContext);
}

async function recheckUnmatchedFulfillmentPlans(query = {}, authContext = {}) {
  const limit = Math.min(Number(query.limit) || RECHECK_BATCH_DEFAULT_LIMIT, RECHECK_BATCH_MAX_LIMIT);
  const page = await listOrderItemsForMapping({ ...query, limit }, authContext, MAPPING_WRITE);
  const result = {
    checked: 0,
    resolved: 0,
    blocked: 0,
    skippedExisting: 0,
    items: [],
  };

  for (const item of page.items || []) {
    const orderItemId = toId(item);
    result.checked += 1;
    const existing = await repository.findByOrderItem(orderItemId);
    if (isReadyPlan(existing)) {
      result.skippedExisting += 1;
      result.items.push({
        orderItemId,
        status: 'SKIPPED_EXISTING',
        fulfillmentPlanId: toId(existing),
      });
      continue;
    }

    const resolved = await recheckFulfillmentPlan(orderItemId, {}, authContext);
    if (resolved && resolved.status === fulfillmentPlanStatuses.READY) {
      result.resolved += 1;
      result.items.push({
        orderItemId,
        status: 'RESOLVED',
        fulfillmentPlanId: toId(resolved),
      });
      continue;
    }

    const blockingReasons = resolved.blockingReasons || [];
    result.blocked += 1;
    result.items.push({
      orderItemId,
      status: 'BLOCKED',
      blockingReasons,
      recommendedFixTypes: recommendedFixTypes(blockingReasons),
    });
  }

  return result;
}

const confirmFulfillmentPlan = selectFulfillmentPlan;

async function getFulfillmentPlanForOrderItem(orderItemId, authContext) {
  const item = await loadOrderItem(orderItemId);
  assertCanAccessShop(item.shopId, MAPPING_READ, authContext);
  return toFulfillmentPlanDto(await repository.findActiveByOrderItem(orderItemId));
}

async function listFulfillmentPlansByOrderItemIds(orderItemIds = [], authContext) {
  orderItemIds.forEach((orderItemId) => assertValidObjectId(orderItemId, 'orderItemId'));
  if (hasGlobalPermission(authContext, MAPPING_READ)) {
    return (await repository.listByOrderItemIds(orderItemIds)).map(toFulfillmentPlanDto);
  }

  const items = await Promise.all(orderItemIds.map((orderItemId) => loadOrderItem(orderItemId)));
  items.forEach((item) => assertCanAccessShop(item.shopId, MAPPING_READ, authContext));
  return (await repository.listByOrderItemIds(orderItemIds)).map(toFulfillmentPlanDto);
}

const listFulfillmentPlansForOrderItems = listFulfillmentPlansByOrderItemIds;

module.exports = {
  buildCostEstimate,
  getMappingConfigWorkbench,
  parseInternalSku,
  previewFulfillmentPlan,
  recheckFulfillmentPlan,
  recheckUnmatchedFulfillmentPlans,
  resolveFulfillmentPlan,
  searchVendorCandidatesForOrderItem,
  selectFulfillmentPlan,
  confirmFulfillmentPlan,
  getFulfillmentPlanForOrderItem,
  listFulfillmentPlansForOrderItems,
  listFulfillmentPlansByOrderItemIds,
};
