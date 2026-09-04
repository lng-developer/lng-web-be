const AppError = require('../../../shared/errors/appError');
const { performance } = require('node:perf_hooks');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const { parseSku } = require('../../../shared/utils/sku');
const authPublic = require('../../auth/public');
const catalogPublic = require('../../catalog/public');
const customizationPublic = require('../../customization/public');
const orderPublic = require('../../order/public');
const vendorPublic = require('../../vendor/public');
const fulfillmentSideEffectQueue = require('./fulfillmentSideEffectQueue.service');
const repository = require('../repositories/fulfillmentPlan.repository');
const {
  costCenterMatchReasons,
  costCenterNormalizationPatterns,
  fulfillmentBlockingReasons,
  fulfillmentCheckStatuses,
  fulfillmentPlanSelectionModes,
  fulfillmentPipelineStageBlockers,
  fulfillmentPlanStatuses,
  fulfillmentTimelineEvents,
  fulfillmentTimelineSources,
  productTypeCodeReplacements,
} = require('../constants/fulfillmentPlan.constants');
const {
  confidenceLevels,
  mappingPermissions,
  mappingScopeTypes,
  matchTargets,
  semanticRoles,
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
const { applySkuNormalizeRules } = require('./skuNormalization.helpers');

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
const RECHECK_BATCH_DEFAULT_LIMIT = 10;
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

async function syncWorkbenchFulfillmentPlan(plan) {
  const fulfillmentPlan = toFulfillmentPlanDto(plan);
  if (!fulfillmentPlan?.orderId || !fulfillmentPlan?.orderItemId) return;
  await orderPublic.updateOrderWorkbenchItem(
    fulfillmentPlan.orderId,
    fulfillmentPlan.orderItemId,
    { fulfillmentPlan },
    { source: 'MAPPING' },
  );
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
    if ([
      fulfillmentBlockingReasons.SKU_CONFIG_AMBIGUOUS,
      fulfillmentBlockingReasons.LISTING_NOT_FOUND,
      fulfillmentBlockingReasons.LISTING_VARIANT_NOT_FOUND,
      fulfillmentBlockingReasons.LISTING_CONFIGURATION_REQUIRED,
    ].includes(reason)) {
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

function blockedStageFor(blockingReasons = []) {
  const fixType = recommendedFixTypes(blockingReasons)[0];
  return {
    SKU_CONFIG: 'PRODUCT_MAPPING',
    SEMANTIC_RULE: 'INPUT_SEMANTICS',
    VALUE_ALIAS: 'VALUE_ALIASES',
    VENDOR_PRODUCT: 'VENDOR_ROUTING',
    VENDOR_COST_CENTER: 'VENDOR_ROUTING',
  }[fixType] || null;
}

function pushBlock(preview, reason) {
  if (!preview.blockingReasons.includes(reason)) preview.blockingReasons.push(reason);
}

function hasOnlyCustomizationBlock(preview) {
  const reasons = preview.blockingReasons || [];
  return reasons.length > 0
    && reasons.every((reason) => reason === fulfillmentBlockingReasons.CUSTOMIZATION_NOT_READY);
}

function canPersistVendorSelection(preview) {
  return Boolean(preview.ready || hasOnlyCustomizationBlock(preview));
}

function canPersistManualOverride(preview, selectionMode, vendorProduct) {
  if (selectionMode !== fulfillmentPlanSelectionModes.MANUAL || !toId(vendorProduct?.productTypeGroupId)) return false;
  const overridableBlocks = new Set([
    fulfillmentBlockingReasons.LISTING_NOT_FOUND,
    fulfillmentBlockingReasons.LISTING_VARIANT_NOT_FOUND,
    fulfillmentBlockingReasons.LISTING_CONFIGURATION_REQUIRED,
    fulfillmentBlockingReasons.INTERNAL_TEMPLATE_NOT_FOUND,
    fulfillmentBlockingReasons.SKU_CONFIG_AMBIGUOUS,
    fulfillmentBlockingReasons.CUSTOMIZATION_NOT_READY,
    fulfillmentBlockingReasons.NO_VENDOR_PRODUCT_CANDIDATE,
    fulfillmentBlockingReasons.NO_VENDOR_COST_CENTER_CANDIDATE,
    fulfillmentBlockingReasons.NO_HIGH_CONFIDENCE_VENDOR_CANDIDATE,
  ]);
  const reasons = preview.blockingReasons || [];
  return reasons.length > 0 && reasons.every((reason) => overridableBlocks.has(reason));
}

function idEquals(left, right) {
  return toId(left) === toId(right);
}

function itemNeedsCustomization(item) {
  return Boolean(item && item.customizationRawSummary && item.customizationRawSummary.hasCustomization);
}

function parseInternalSku(sku) {
  const parsed = parseSku(sku);
  return {
    employeeCode: parsed.employeeCode,
    configCode: parsed.configCode,
    dateCode: parsed.dateCode,
    sequence: parsed.sequence,
  };
}

function moneyAmount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizePrintMethod(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

function supportsPrintMethod(candidate = {}, printMethod) {
  const normalized = normalizePrintMethod(printMethod);
  if (!normalized) return true;
  return normalizePrintMethod(candidate.printMethod) === normalized;
}

function isTwoSidedConfig(configCode) {
  return String(configCode || '').trim().toUpperCase() === 'TSB';
}

function isTwoPositionConfig(configCode) {
  return ['TS2S', 'QZES'].includes(String(configCode || '').trim().toUpperCase());
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

function shippingProfileFor(order = {}, costCenter = {}) {
  const service = `${order.shippingService?.level || ''} ${order.shippingService?.name || ''}`.toUpperCase();
  const requested = /EXPEDITED|PRIORITY|EXPRESS/.test(service)
    ? 'priority'
    : String(order.shippingAddress?.countryCode || '').toUpperCase() === 'US'
      ? 'domestic'
      : 'international';
  const profiles = {
    priority: costCenter.priorityShipping,
    domestic: costCenter.domesticShipping,
    international: costCenter.internationalShipping,
  };
  const hasRates = (profile) => profile
    && (Number.isInteger(profile.economyAmount) || Number.isInteger(profile.additionalAmount));
  return hasRates(profiles[requested])
    ? { name: requested, rates: profiles[requested] }
    : { name: 'international', rates: profiles.international || {} };
}

function buildCostEstimate({ costCenter = {}, item = {}, order = {}, skuMapping = {}, customerInputs = {}, normalizedInputs = [] } = {}) {
  const priority = hasPrioritySignal(item, customerInputs, normalizedInputs);
  const twoSided = isTwoSidedConfig(skuMapping.configCode);
  const twoPosition = isTwoPositionConfig(skuMapping.configCode);
  const embroidery = ['EBM', 'EBMA'].includes(String(skuMapping.configCode || '').trim().toUpperCase())
    || hasEmbroiderySignal(customerInputs, normalizedInputs);
  const additionalCosts = costCenter.additionalCosts || {};
  const quantity = Math.max(1, Number(item.quantity) || 1);
  const shipping = shippingProfileFor(order, costCenter);
  const lines = [
    { code: 'BASE_COST', label: 'Base cost', amount: moneyAmount(costCenter.baseCostAmount) * quantity },
    { code: 'UNIT_SURCHARGE', label: 'Unit surcharge', amount: 100 * quantity },
    { code: 'TWO_SIDED_PRINT', label: 'Two-sided print', amount: twoSided ? moneyAmount(additionalCosts.twoSidedPrintAmount) * quantity : 0 },
    { code: 'TWO_POSITION_PRINT', label: 'Two-position print', amount: twoPosition ? moneyAmount(additionalCosts.twoPositionPrintAmount) * quantity : 0 },
    { code: 'EMBROIDERY', label: 'Embroidery', amount: embroidery ? moneyAmount(additionalCosts.embroideryAmount) * quantity : 0 },
    { code: 'SHIPPING_ECONOMY', label: 'Shipping economy', amount: moneyAmount(shipping.rates.economyAmount) },
    { code: 'SHIPPING_ADDITIONAL', label: 'Additional-unit shipping', amount: moneyAmount(shipping.rates.additionalAmount) * Math.max(quantity - 1, 0) },
    { code: 'IMPORT_TAX', label: 'Import tax', amount: moneyAmount(costCenter.importTaxAmount) * quantity },
    { code: 'EXTRA_FEE', label: 'Extra fee', amount: 0 },
  ];
  return {
    currency: costCenter.currency || 'USD',
    totalAmount: lines.reduce((total, line) => total + line.amount, 0),
    lines,
    signals: {
      configCode: skuMapping.configCode || null,
      twoSided,
      twoPosition,
      embroidery,
      priority,
      shippingProfile: shipping.name,
      quantity,
    },
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
    size: normalizeComparableSize(byRole.SIZE || variant.standardSize || variant.size || variant.Size),
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

function normalizeComparableSize(value) {
  const normalized = normalizeCostCenterValue(value);
  const dimension = normalized.match(/(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/);
  return dimension ? `${dimension[1]}X${dimension[2]}` : normalized;
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
  const standardSizeMatch = terms.size && normalizeComparableSize(costCenter.standardSize) === terms.size;
  const standardColorMatch = terms.color && normalizeCostCenterValue(costCenter.standardColor) === terms.color;
  const vendorSizeMatch = terms.size && normalizeComparableSize(costCenter.vendorSize) === terms.size;
  const vendorColorMatch = terms.color && normalizeCostCenterValue(costCenter.vendorColor) === terms.color;
  const attributes = costCenter.attributes || {};
  const attrSizeMatch = terms.size && normalizeComparableSize(attributes.size) === terms.size;
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
  const colorAgnostic = !costCenter.standardColor && !costCenter.vendorColor && !attributes.color;
  const confidence = score >= 80 || (colorAgnostic && standardSizeMatch && vendorSizeMatch)
    ? confidenceLevels.HIGH
    : score >= 40 ? confidenceLevels.MEDIUM : confidenceLevels.LOW;
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
    listingVariantId: null,
    internalTemplate: null,
    vendorProductCandidates: [],
    costCenterCandidates: [],
    item: null,
  };
}

async function getCustomizationCheck(item, template, customizationView) {
  if (!itemNeedsCustomization(item) && !templateNeedsCustomization(template)) {
    return { ok: true, status: fulfillmentCheckStatuses.NOT_REQUIRED };
  }

  if (customizationView?.status) {
    return {
      ok: customizationView.status === 'PARSED',
      status: customizationView.status,
    };
  }

  try {
    const payload = await customizationPublic.assertCustomizationReady(item._id || item.id);
    return { ok: true, status: payload.status || fulfillmentCheckStatuses.READY };
  } catch (error) {
    return { ok: false, status: fulfillmentCheckStatuses.NOT_READY };
  }
}

async function getCustomizationView(item, authContext) {
  if (typeof customizationPublic.getOrderItemCustomizationView !== 'function') return {};
  try {
    return await customizationPublic.getOrderItemCustomizationView(item._id || item.id) || {};
  } catch (_error) {
    return {};
  }
}

async function getCustomerInputs(item, authContext) {
  const view = await getCustomizationView(item, authContext);
  return view && view.customerInputs ? view.customerInputs : {};
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

function costEstimateAmount(candidate) {
  return candidate?.costEstimate?.totalAmount ?? Number.MAX_SAFE_INTEGER;
}

function buildAutoMatch(preview) {
  if (!canPersistVendorSelection(preview)) return null;
  const highConfidenceCandidates = preview.costCenterCandidates
    .filter((candidate) => candidate.confidence === confidenceLevels.HIGH);
  const routedCandidates = highConfidenceCandidates
    .filter((candidate) => (candidate.routingSpecificity || 0) > 0);
  const candidates = routedCandidates.length > 0 ? routedCandidates : highConfidenceCandidates;
  const [top] = candidates.slice().sort(routedCandidates.length > 0
    ? sortCostCenters
    : (left, right) => costEstimateAmount(left) - costEstimateAmount(right) || sortCostCenters(left, right));
  if (!top) return null;
  const tied = candidates.filter((candidate) => (routedCandidates.length > 0
    ? (candidate.routingSpecificity || 0) === (top.routingSpecificity || 0)
      && (candidate.routingPriority || 999999) === (top.routingPriority || 999999)
      && (candidate.matchTier || 0) === (top.matchTier || 0)
      && (candidate.matchScore || 0) === (top.matchScore || 0)
      && (candidate.baseCostAmount ?? 999999999) === (top.baseCostAmount ?? 999999999)
    : costEstimateAmount(candidate) === costEstimateAmount(top)
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

  const normalizedInputs = query.manualBrowse
    ? []
    : (await mappingRuleService.buildNormalizedInputs({
      context: {
        shopId: item.shopId,
        salesChannelCode: item.salesChannelCode,
        marketplaceCode: item.marketplaceCode,
      },
      customerInputs: await getCustomerInputs(item, authContext),
      internalTemplate: {},
    })).normalizedInputs || [];
  const size = query.size || (!query.manualBrowse
    ? firstNormalizedValue(normalizedInputs, semanticRoles.SIZE)
    : null);
  const color = query.color || (!query.manualBrowse
    ? firstNormalizedValue(normalizedInputs, semanticRoles.COLOR)
    : null);
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
    includeTotal: query.includeTotal !== false,
    page: query.page || 1,
    limit: query.limit || 20,
  });

  const productResult = query.manualBrowse && query.vendorId
    ? await vendorPublic.listVendorProducts({
      vendorId: query.vendorId,
      status: 'ACTIVE',
      page: 1,
      limit: 100,
    })
    : null;

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
    products: (productResult?.items || []).map(toSearchProduct),
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

function skuRuleSpecificity(rule = {}) {
  return (rule.shopId ? 8 : 0)
    + (rule.salesChannelCode ? 4 : 0)
    + (rule.marketplaceCode ? 4 : 0)
    + (rule.countryCode ? 2 : 0);
}

function selectSkuConfigRule(rules = [], normalizedInputs = []) {
  if (!rules.length) return { rule: null, ambiguous: false, matchedAlias: null };
  if (rules.length === 1) return { rule: rules[0], ambiguous: false, matchedAlias: null };
  const signals = new Set(productTypeSignals(normalizedInputs));
  const matches = signals.size ? rules.map((rule) => {
    const matchedAlias = ruleAliases(rule).find((alias) => signals.has(alias));
    return matchedAlias ? { rule, matchedAlias } : null;
  }).filter(Boolean) : rules.map((rule) => ({ rule, matchedAlias: null }));
  if (!matches.length) return { rule: null, ambiguous: true, matchedAlias: null };
  const sorted = [...matches].sort((left, right) => (
    skuRuleSpecificity(right.rule) - skuRuleSpecificity(left.rule)
    || (left.rule.priority ?? 100) - (right.rule.priority ?? 100)
  ));
  const top = sorted[0];
  const topSpecificity = skuRuleSpecificity(top.rule);
  const topPriority = top.rule.priority ?? 100;
  const topMatches = sorted.filter((match) => (
    skuRuleSpecificity(match.rule) === topSpecificity
    && (match.rule.priority ?? 100) === topPriority
  ));
  const topTarget = `${toId(top.rule.productTypeGroupId) || ''}:${toId(top.rule.internalTemplateId) || ''}`;
  const targetTied = topMatches.filter((match) => (
    `${toId(match.rule.productTypeGroupId) || ''}:${toId(match.rule.internalTemplateId) || ''}` !== topTarget
  ));
  if (targetTied.length) return { rule: null, ambiguous: true, matchedAlias: null };
  return { rule: top.rule, ambiguous: false, matchedAlias: top.matchedAlias };
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
  const orderPromise = item.orderId ? orderPublic.findById(item.orderId) : Promise.resolve(null);

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
    order: undefined,
  };

  const [skuNormalizeRules, customizationView] = await Promise.all([
    mappingRuleService.listActiveSkuNormalizeRulesForContext({
      shopId: toId(item.shopId),
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
    }),
    getCustomizationView(item, authContext),
  ]);
  preview.skuNormalization = applySkuNormalizeRules(item.sku, skuNormalizeRules);
  const effectiveItem = { ...item, sku: preview.skuNormalization.canonicalSku };

  const parsedSku = parseInternalSku(preview.skuNormalization.canonicalSku);
  const findListingForOrderItem = catalogPublic.findListingForOrderItem || catalogPublic.findListingBySku;
  const listingPromise = (async () => {
    const primary = await findListingForOrderItem({
      shopId: item.shopId,
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      asin: item.asin,
      sku: preview.skuNormalization.canonicalSku,
      fallbackSku: preview.skuNormalization.originalSku,
    });
    if (primary || preview.skuNormalization.canonicalSku === preview.skuNormalization.originalSku) return primary;
    return findListingForOrderItem({
      shopId: item.shopId,
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      asin: item.asin,
      sku: preview.skuNormalization.originalSku,
    });
  })();
  const skuRulesPromise = parsedSku.configCode
    ? mappingRuleService.listActiveSkuConfigRulesForContext({
      shopId: toId(item.shopId),
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      configCode: parsedSku.configCode,
    })
    : Promise.resolve([]);
  let [listing, skuRules] = await Promise.all([listingPromise, skuRulesPromise]);

  if (listing) {
    preview.listing = listing;
    preview.checks.listing = { ok: true, status: fulfillmentCheckStatuses.FOUND };
  }

  let listingProductTypeGroupId = null;
  let listingTemplate = null;
  let normalizedTemplateId = listingTemplate ? toId(listingTemplate) : null;
  const customerInputs = customizationView && customizationView.customerInputs ? customizationView.customerInputs : {};
  preview.customerInputs = customerInputs;
  preview.listingPreviewImageUrl = customizationView?.listingPreviewImageUrl || customerInputs.listingPreviewImageUrl || null;
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

  const customizationProductTypeGroupId = preview.skuMapping.productTypeGroupId
    ? preview.skuMapping.productTypeGroupId
    : await resolveSelectedProductTypeGroupId(preview.normalizedInputs, null);
  let selectedProductTypeGroupId = customizationProductTypeGroupId;

  if (listing && typeof catalogPublic.resolveListingVariant === 'function') {
    const hasSelectedProductType = Boolean(preview.skuMapping.productTypeGroupId)
      || preview.normalizedInputs.some((input) => input.semanticRole === semanticRoles.PRODUCT_TYPE);
    const resolvedListing = await catalogPublic.resolveListingVariant(
      toId(listing),
      hasSelectedProductType ? customizationProductTypeGroupId : null,
    );
    if (!resolvedListing || !resolvedListing.variant) {
      if (!hasSelectedProductType) {
        pushBlock(preview, fulfillmentBlockingReasons.LISTING_VARIANT_NOT_FOUND);
        return preview;
      }
    }
    if (resolvedListing?.variant) {
      const variant = resolvedListing.variant;
      preview.listingVariantId = toId(variant);
      preview.printMethod = normalizePrintMethod(variant.printMethod || variant.productTypeGroupId?.printMethod);
      selectedProductTypeGroupId = toId(variant.productTypeGroupId);
      listingProductTypeGroupId = toId(variant.productTypeGroupId);
      listingTemplate = variant.internalTemplateId
        ? await catalogPublic.getInternalTemplateById(toId(variant.internalTemplateId))
        : null;
      preview.listing = {
        ...listing,
        productTypeGroupId: variant.productTypeGroupId,
        internalTemplateId: variant.internalTemplateId || null,
        psdTemplateAssetId: variant.psdTemplateAssetId || null,
        previewAssetId: variant.previewAssetId || null,
        printMethod: preview.printMethod || null,
      };
    }
  }
  if (!preview.printMethod && listing?.productTypeGroupId?.printMethod) {
    preview.printMethod = normalizePrintMethod(listing.productTypeGroupId.printMethod);
  }
  preview.productTypeGroupId = selectedProductTypeGroupId;
  preview.order = await orderPromise;

  if (!selectedProductTypeGroupId) {
    if (!listing && options.createDraftListing) {
      listing = await catalogPublic.findOrCreateDraftListingForOrderItem({
        shopId: item.shopId,
        salesChannelCode: item.salesChannelCode,
        marketplaceCode: item.marketplaceCode,
        asin: item.asin,
        sku: preview.skuNormalization.canonicalSku,
        fallbackSku: preview.skuNormalization.originalSku,
        title: item.title,
        productImageUrl: preview.listingPreviewImageUrl || preview.customerInputs?.listingPreviewImageUrl,
        currency: item.price?.currency || item.currency || null,
      }, authContext);
      if (listing) {
        preview.listing = listing;
        preview.checks.listing = { ok: true, status: fulfillmentCheckStatuses.FOUND };
        const listingId = toId(listing._id || listing.id);
        if (listingId && String(item.listingId || '') !== listingId && typeof orderPublic.updateItemListingId === 'function') {
          await orderPublic.updateItemListingId(orderItemId, listingId);
        }
      }
    }
    pushBlock(preview, listing
      ? fulfillmentBlockingReasons.LISTING_CONFIGURATION_REQUIRED
      : fulfillmentBlockingReasons.LISTING_NOT_FOUND);
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
      productImageUrl: preview.listingPreviewImageUrl || preview.customerInputs?.listingPreviewImageUrl,
      currency: item.price?.currency || item.currency || null,
    }, authContext);
    if (listing) {
      preview.listing = listing;
      preview.checks.listing = { ok: true, status: fulfillmentCheckStatuses.FOUND };
      const listingId = toId(listing._id || listing.id);
      if (listingId && String(item.listingId || '') !== listingId && typeof orderPublic.updateItemListingId === 'function') {
        await orderPublic.updateItemListingId(orderItemId, listingId);
      }
    }
  }

  if (options.createMissingListing && listing) {
    const listingId = toId(listing._id || listing.id);
    if (listingId && String(item.listingId || '') !== listingId && typeof orderPublic.updateItemListingId === 'function') {
      await orderPublic.updateItemListingId(orderItemId, listingId);
    }
  }

  const internalTemplate = listingTemplate
    || (preview.skuMapping.internalTemplateId
      ? await catalogPublic.getInternalTemplateById(preview.skuMapping.internalTemplateId)
      : null);
  if (internalTemplate && toId(internalTemplate) !== normalizedTemplateId) {
    const normalizedWithTemplate = await mappingRuleService.buildNormalizedInputs({
      context: {
        shopId: toId(item.shopId),
        salesChannelCode: item.salesChannelCode,
        marketplaceCode: item.marketplaceCode,
        productTypeGroupId: selectedProductTypeGroupId || null,
      },
      customerInputs,
      internalTemplate,
      parsingConfig: mergeSkuParsingConfig(skuRules),
    });
    preview.normalizedInputs = normalizedWithTemplate.normalizedInputs || [];
    (normalizedWithTemplate.blockingReasons || []).forEach((reason) => pushBlock(preview, reason));
    normalizedTemplateId = toId(internalTemplate);
  }
  if (internalTemplate) {
    preview.internalTemplate = internalTemplate;
    preview.checks.internalTemplate = { ok: true, status: fulfillmentCheckStatuses.FOUND };
  }

  const [customization, vendorProducts] = await Promise.all([
    getCustomizationCheck(item, internalTemplate, customizationView),
    vendorPublic.listActiveVendorProductsByProductTypeGroup(selectedProductTypeGroupId),
  ]);
  preview.checks.customization = customization;
  if (!customization.ok) pushBlock(preview, fulfillmentBlockingReasons.CUSTOMIZATION_NOT_READY);

  preview.vendorProductCandidates = vendorProducts || [];
  preview.checks.vendorProducts = { ok: preview.vendorProductCandidates.length > 0, count: preview.vendorProductCandidates.length };
  if (preview.vendorProductCandidates.length === 0) pushBlock(preview, fulfillmentBlockingReasons.NO_VENDOR_PRODUCT_CANDIDATE);

  const routingTerms = termsFromItem(effectiveItem, preview.normalizedInputs);
  const productIds = preview.vendorProductCandidates.map((product) => product._id || product.id).filter(Boolean);
  const [routingRules, costCenterRows] = await Promise.all([
    mappingRuleService.listActiveVendorRoutingRulesForContext({
      shopId: toId(item.shopId),
      salesChannelCode: item.salesChannelCode,
      marketplaceCode: item.marketplaceCode,
      productTypeGroupId: selectedProductTypeGroupId,
      asin: item.asin || null,
      configCode: preview.skuMapping.configCode || null,
      normalizedSize: routingTerms.size || null,
      normalizedColor: routingTerms.color || null,
    }),
    typeof vendorPublic.listActiveVendorCostCentersByProductIds === 'function'
      ? vendorPublic.listActiveVendorCostCentersByProductIds(productIds)
      : Promise.all(productIds.map((productId) => vendorPublic.listActiveVendorCostCenters(productId))).then((rows) => rows.flat()),
  ]);
  const costCentersByProductId = costCenterRows.reduce((result, row) => {
    const key = toId(row.vendorProductId);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
    return result;
  }, new Map());
  const costCentersByProduct = preview.vendorProductCandidates.map((product) => {
    const productId = product._id || product.id;
    const route = routingRank(product, routingRules);
    const rows = (costCentersByProductId.get(toId(productId)) || [])
      .filter((row) => supportsPrintMethod(row, preview.printMethod));
    return (rows || []).map((row) => ({
      ...row,
      vendorProductId: row.vendorProductId || productId,
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
        order: preview.order,
        skuMapping: preview.skuMapping,
        customerInputs: preview.customerInputs,
        normalizedInputs: preview.normalizedInputs,
      }),
    }));
  });
  preview.costCenterCandidates = costCentersByProduct.flat().sort(sortCostCenters);
  preview.checks.costCenters = { ok: preview.costCenterCandidates.length > 0, count: preview.costCenterCandidates.length };
  if (preview.costCenterCandidates.length === 0) pushBlock(preview, fulfillmentBlockingReasons.NO_VENDOR_COST_CENTER_CANDIDATE);

  preview.ready = preview.blockingReasons.length === 0;
  preview.autoMatch = buildAutoMatch(preview);
  if (preview.ready && !preview.autoMatch && preview.costCenterCandidates.length > 0) {
    pushBlock(preview, fulfillmentBlockingReasons.NO_HIGH_CONFIDENCE_VENDOR_CANDIDATE);
    preview.ready = false;
  }
  return preview;
}

async function previewFulfillmentPlan(orderItemId, options = {}, authContext) {
  return toPreviewDto(await buildPreview(orderItemId, authContext), options);
}

function emptyOrderItemPage(page = 1, limit = 20) {
  return { items: [], pagination: { total: 0, page, limit } };
}

async function listOrderItemsForMapping(query = {}, authContext = {}, permission = MAPPING_READ) {
  const limit = Math.min(Number(query.limit) || RECHECK_BATCH_DEFAULT_LIMIT, RECHECK_BATCH_MAX_LIMIT);
  const page = Math.max(Number(query.page) || 1, 1);
  const itemQuery = {
    shopId: query.shopId,
    salesChannelCode: query.salesChannelCode,
    marketplaceCode: query.marketplaceCode,
    q: query.q,
    status: query.status,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    page,
    limit,
  };

  if (itemQuery.shopId) {
    assertCanAccessShop(itemQuery.shopId, permission, authContext);
    return orderPublic.listItems(itemQuery);
  }

  if (hasGlobalPermission(authContext, permission)) return orderPublic.listItems(itemQuery);

  const shopIds = getScopedShopIds(authContext, permission);
  if (!shopIds.length) return emptyOrderItemPage(page, limit);
  return orderPublic.listItems({ ...itemQuery, shopIds });
}

function toUnmatchedSample(preview) {
  return {
    id: toId(preview.orderItemId),
    orderItemId: toId(preview.orderItemId),
    externalOrderId: preview.item?.externalOrderId || null,
    sku: preview.item ? preview.item.sku || null : null,
    title: preview.item?.title || null,
    createdAt: preview.item?.createdAt || null,
    blockingReasons: preview.blockingReasons || [],
    skuNormalization: preview.skuNormalization || null,
    skuMapping: preview.skuMapping || null,
    normalizedInputs: preview.normalizedInputs || [],
    recommendedFixTypes: recommendedFixTypes(preview.blockingReasons || []),
    blockedStage: blockedStageFor(preview.blockingReasons || []),
  };
}

function toLightUnmatchedSample(item, plan) {
  const blockingReasons = plan?.blockingReasons || [];
  return {
    id: toId(item._id || item.id),
    orderItemId: toId(item._id || item.id),
    externalOrderId: item.externalOrderId || null,
    sku: item.sku || null,
    title: item.title || null,
    createdAt: item.createdAt || null,
    blockingReasons,
    skuNormalization: null,
    skuMapping: null,
    normalizedInputs: [],
    recommendedFixTypes: recommendedFixTypes(blockingReasons),
    blockedStage: blockedStageFor(blockingReasons),
  };
}

async function listUnmatchedOrderItems(query = {}, authContext = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Number(query.limit) || 20, RECHECK_BATCH_MAX_LIMIT);
  const persistedQuery = { ...query, page, limit };
  if (persistedQuery.shopId) {
    assertCanAccessShop(persistedQuery.shopId, MAPPING_READ, authContext);
  } else if (!hasGlobalPermission(authContext, MAPPING_READ)) {
    persistedQuery.shopIds = getScopedShopIds(authContext, MAPPING_READ);
    if (!persistedQuery.shopIds.length) return { items: [], limit, page, pagination: { limit, page, total: 0 }, total: 0 };
  }
  if (query.stage) persistedQuery.blockers = fulfillmentPipelineStageBlockers[query.stage] || ['__NO_MATCH__'];

  const repositoryStartedAt = performance.now();
  const result = await repository.listUnmatched(persistedQuery);
  const repositoryMs = Math.round(performance.now() - repositoryStartedAt);
  const items = (result.items || []).map((plan) => toLightUnmatchedSample(plan.snapshot?.orderItem || {}, plan));
  const total = result.pagination?.total || 0;

  return {
    items,
    limit,
    page,
    pagination: { limit, page, total },
    total,
    timing: { repositoryMs },
  };
}

async function summarizeMapping(query = {}, authContext = {}) {
  const persistedQuery = { ...query };
  if (persistedQuery.shopId) {
    assertCanAccessShop(persistedQuery.shopId, MAPPING_READ, authContext);
  } else if (!hasGlobalPermission(authContext, MAPPING_READ)) {
    persistedQuery.shopIds = getScopedShopIds(authContext, MAPPING_READ);
    if (!persistedQuery.shopIds.length) {
      return {
        readyPlanCount: 0,
        confirmedPlanCount: 0,
        totalPlanCount: 0,
        blockedSampleCount: 0,
        missingSkuConfigCount: 0,
        missingSemanticRuleCount: 0,
        missingVendorProductCount: 0,
        missingVendorCostCenterCount: 0,
        ambiguousSkuConfigCount: 0,
        byStatus: {},
        bySelectionMode: {},
      };
    }
  }

  const planSummary = await repository.summarize(persistedQuery);
  const blockerCounts = planSummary.byBlockingReason || {};

  return {
    readyPlanCount: planSummary.byStatus?.[fulfillmentPlanStatuses.READY] || 0,
    confirmedPlanCount: planSummary.byStatus?.[fulfillmentPlanStatuses.CONFIRMED] || 0,
    totalPlanCount: planSummary.total || 0,
    blockedSampleCount: planSummary.byStatus?.[fulfillmentPlanStatuses.BLOCKED] || 0,
    missingSkuConfigCount: blockerCounts[fulfillmentBlockingReasons.LISTING_NOT_FOUND] || 0,
    missingSemanticRuleCount: (blockerCounts.TEMPLATE_REQUIRED_INPUT_MISSING || 0)
      + (blockerCounts[fulfillmentBlockingReasons.CUSTOMIZATION_NOT_READY] || 0),
    missingVendorProductCount: blockerCounts[fulfillmentBlockingReasons.NO_VENDOR_PRODUCT_CANDIDATE] || 0,
    missingVendorCostCenterCount: blockerCounts[fulfillmentBlockingReasons.NO_VENDOR_COST_CENTER_CANDIDATE] || 0,
    ambiguousSkuConfigCount: blockerCounts[fulfillmentBlockingReasons.SKU_CONFIG_AMBIGUOUS] || 0,
    stageCounts: {
      SKU_CLEANUP: 0,
      PRODUCT_MAPPING: planSummary.byStage?.PRODUCT_MAPPING || 0,
      INPUT_SEMANTICS: planSummary.byStage?.INPUT_SEMANTICS || 0,
      VALUE_ALIASES: planSummary.byStage?.VALUE_ALIASES || 0,
      VENDOR_ROUTING: planSummary.byStage?.VENDOR_ROUTING || 0,
    },
    byStatus: planSummary.byStatus || {},
    bySelectionMode: planSummary.bySelectionMode || {},
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
    listing: { ...compactListing(preview.listing), printMethod: preview.printMethod || null },
    internalTemplate: compactTemplate(preview.internalTemplate),
    vendor: compactVendor(vendor),
    vendorProduct: compactVendorProduct(vendorProductSnapshotSource),
    vendorCostCenter: compactCostCenter(costCenterSnapshotSource),
    costEstimate: buildCostEstimate({
      costCenter,
      item: preview.item,
      order: preview.order,
      skuMapping: preview.skuMapping,
      customerInputs: preview.customerInputs,
      normalizedInputs: preview.normalizedInputs,
    }),
  };
}

async function triggerProductionTaskForReadyPlan(orderItemId, plan, authContext) {
  const startedAt = Date.now();
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
  } finally {
    logger.info('Auto production task trigger completed', {
      orderItemId,
      fulfillmentPlanId: toId(plan),
      durationMs: Date.now() - startedAt,
    });
  }
}

async function applyFulfillmentSideEffects({ orderItemId, orderId, markReady = false, triggerProduction = false, authContext = {} }) {
  await Promise.all([
    orderPublic.updateCostCenterStatusForOrder(orderId),
    orderPublic.updatePsdStatusForOrder(orderId),
  ]);
  if (markReady) {
    await markFulfillmentReadyAfterPlan(orderItemId);
  }
  if (triggerProduction) {
    await triggerProductionTaskForReadyPlan(orderItemId, {}, authContext);
  }
}

async function scheduleFulfillmentSideEffects(orderItemId, orderId, { markReady = false, triggerProduction = false }, authContext) {
  const payload = { orderItemId, orderId, markReady, triggerProduction, authContext: authContext || {} };
  const result = await fulfillmentSideEffectQueue.enqueueFulfillmentSideEffects(payload);
  if (!result.queued) await applyFulfillmentSideEffects(payload);
}

async function markFulfillmentReadyAfterPlan(orderItemId) {
  try {
    await orderPublic.markFulfillmentReady(orderItemId);
    return true;
  } catch (error) {
    logger.warn('Auto fulfillment-ready skipped after mapping', { orderItemId, error });
    return false;
  }
}

async function prepareProductionForManualOverride(orderItemId, authContext) {
  const productionPublic = require('../../production/public');
  if (typeof productionPublic.prepareForMappingOverride !== 'function') return null;
  return productionPublic.prepareForMappingOverride(orderItemId, {
    ...(authContext || {}),
    system: true,
    source: 'MAPPING_OVERRIDE',
  });
}

async function persistReadyPlan(orderItemId, payload = {}, authContext, selectionMode, options = {}) {
  assertSelectionPayload(payload);
  const preview = options.preview || await buildPreview(orderItemId, authContext, options);
  if (!preview.item) {
    throw conflict('Fulfillment plan is blocked', toPreviewDto(preview, { includeCandidates: false }));
  }
  assertCanAccessShop(preview.item.shopId, MAPPING_WRITE, authContext);

  const existingPlan = await repository.findByOrderItem(orderItemId);
  let needsProductionOverride = false;
  if (existingPlan && [fulfillmentPlanStatuses.READY, fulfillmentPlanStatuses.CONFIRMED].includes(existingPlan.status)) {
    const sameSelection = idEquals(existingPlan.vendorProductId, payload.vendorProductId)
      && idEquals(existingPlan.vendorCostCenterId, payload.vendorCostCenterId);
    if (sameSelection && existingPlan.status === fulfillmentPlanStatuses.CONFIRMED) return toFulfillmentPlanDto(existingPlan);
    const canManualOverrideReady = existingPlan.status === fulfillmentPlanStatuses.READY
      && selectionMode === fulfillmentPlanSelectionModes.MANUAL;
    if (!sameSelection && !canManualOverrideReady) {
      throw conflict('Plan already resolved', { blockingReasons: [fulfillmentBlockingReasons.PLAN_ALREADY_RESOLVED] });
    }
    needsProductionOverride = !sameSelection && canManualOverrideReady;
  }

  const vendorProduct = await vendorPublic.getVendorProductById(payload.vendorProductId);
  if (!vendorProduct) {
    throw conflict('Selected vendor product is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_PRODUCT_INVALID] });
  }
  const vendor = await vendorPublic.getVendorById(toId(vendorProduct.vendorId));
  if (!vendor) {
    throw conflict('Selected vendor product is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_PRODUCT_INVALID] });
  }
  const previewProductTypeGroupId = preview.productTypeGroupId || preview.listing?.productTypeGroupId || null;
  const manualOverrideProductType = selectionMode === fulfillmentPlanSelectionModes.MANUAL
    && previewProductTypeGroupId
    && !idEquals(vendorProduct.productTypeGroupId, previewProductTypeGroupId);
  if (previewProductTypeGroupId && !idEquals(vendorProduct.productTypeGroupId, previewProductTypeGroupId) && !manualOverrideProductType) {
    throw conflict('Selected vendor product is invalid', {
      blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_PRODUCT_INVALID],
      vendorProductId: payload.vendorProductId,
      expectedProductTypeGroupId: previewProductTypeGroupId,
      actualProductTypeGroupId: toId(vendorProduct.productTypeGroupId),
    });
  }

  const activeCostCenters = await vendorPublic.listActiveVendorCostCenters(payload.vendorProductId);
  const costCenter = (activeCostCenters || []).find((candidate) => idEquals(candidate, payload.vendorCostCenterId));
  if (!costCenter) {
    throw conflict('Selected vendor cost center is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_COST_CENTER_INVALID] });
  }
  if (!idEquals(costCenter.vendorProductId, payload.vendorProductId) || !idEquals(costCenter.vendorId, vendorProduct.vendorId)) {
    throw conflict('Selected vendor cost center is invalid', { blockingReasons: [fulfillmentBlockingReasons.SELECTED_VENDOR_COST_CENTER_INVALID] });
  }

  const manualOverride = canPersistManualOverride(preview, selectionMode, vendorProduct);
  if (!canPersistVendorSelection(preview) && !manualOverride) {
    throw conflict('Fulfillment plan is blocked', toPreviewDto(preview, { includeCandidates: false }));
  }

  if (needsProductionOverride) {
    await prepareProductionForManualOverride(orderItemId, authContext);
  }

  const resolvedAt = new Date();
  const persistedProductTypeGroupId = manualOverrideProductType
    ? vendorProduct.productTypeGroupId
    : (previewProductTypeGroupId || vendorProduct.productTypeGroupId);
  const snapshotPreview = manualOverrideProductType
    ? { ...preview, productTypeGroupId: persistedProductTypeGroupId }
    : preview;
  const plan = await repository.upsertByOrderItem(orderItemId, {
    orderId: preview.item.orderId,
    orderItemId,
    shopId: preview.item.shopId,
    salesChannelCode: preview.item.salesChannelCode,
    marketplaceCode: preview.item.marketplaceCode,
    listingId: preview.listing ? (preview.listing._id || preview.listing.id) : null,
    listingVariantId: preview.listingVariantId || null,
    internalTemplateId: preview.internalTemplate ? (preview.internalTemplate._id || preview.internalTemplate.id) : null,
    productTypeGroupId: persistedProductTypeGroupId,
    vendorProductId: payload.vendorProductId,
    vendorCostCenterId: payload.vendorCostCenterId,
    status: fulfillmentPlanStatuses.READY,
    selectionMode,
    blockingReasons: preview.ready ? [] : preview.blockingReasons,
    checks: preview.checks,
    snapshot: snapshotFrom({
      preview: snapshotPreview, vendorProduct, costCenter, vendor,
    }),
    resolvedBy: authContext && authContext.accountId ? authContext.accountId : null,
    resolvedAt,
  });

  await syncWorkbenchFulfillmentPlan(plan);


  await orderPublic.appendTimeline({
    orderId: preview.item.orderId,
    orderItemId,
    shopId: preview.item.shopId,
    salesChannelCode: preview.item.salesChannelCode,
    marketplaceCode: preview.item.marketplaceCode,
    eventType: selectionMode === fulfillmentPlanSelectionModes.MANUAL
      ? fulfillmentTimelineEvents.MANUAL_VENDOR_MATCHED
      : fulfillmentTimelineEvents.PLAN_READY,
    source: fulfillmentTimelineSources.MAPPING,
    actorId: authContext && authContext.accountId ? authContext.accountId : null,
    message: selectionMode === fulfillmentPlanSelectionModes.MANUAL ? 'Manual vendor matched' : null,
    metadata: selectionMode === fulfillmentPlanSelectionModes.MANUAL ? {
      selectionMode,
      vendorId: toId(vendor),
      vendorName: vendor.name || null,
      vendorProductId: toId(vendorProduct),
      vendorProductName: vendorProduct.name || null,
      vendorCostCenterId: toId(costCenter),
      vendorCostCenterCode: costCenter.code || null,
      baseCostAmount: costCenter.baseCostAmount ?? null,
      currency: costCenter.currency || null,
    } : {},
  });

  const customizationBlocked = preview.blockingReasons.includes(
    fulfillmentBlockingReasons.CUSTOMIZATION_NOT_READY,
  );
  if (!options.deferSideEffects) {
    await scheduleFulfillmentSideEffects(
      orderItemId,
      preview.item.orderId,
      {
        markReady: preview.ready || (manualOverride && !customizationBlocked),
        triggerProduction: true,
      },
      authContext,
    );
  }

  return toFulfillmentPlanDto(plan);
}

async function selectFulfillmentPlan(orderItemId, payload = {}, authContext) {
  return persistReadyPlan(orderItemId, payload, authContext, fulfillmentPlanSelectionModes.MANUAL);
}

async function resolveFulfillmentPlan(orderItemId, options = {}, authContext) {
  const preview = await buildPreview(orderItemId, authContext, { ...options, createMissingListing: true });
  if (!preview.item) return toPreviewDto(preview, { includeCandidates: false });
  assertCanAccessShop(preview.item.shopId, MAPPING_WRITE, authContext);
  const existingPlan = await repository.findByOrderItem(orderItemId);
  if (isReadyPlan(existingPlan)
    && existingPlan.selectionMode === fulfillmentPlanSelectionModes.MANUAL) {
    return toFulfillmentPlanDto(existingPlan);
  }
  if (!canPersistVendorSelection(preview) || !preview.autoMatch) {
    // Rechecking can link a real listing even when vendor routing is still blocked.
    // Keep the order-level setup badges in sync with that newly resolved listing.
    const plan = await repository.upsertByOrderItem(orderItemId, {
      orderId: preview.item.orderId,
      orderItemId,
      shopId: preview.item.shopId,
      salesChannelCode: preview.item.salesChannelCode,
      marketplaceCode: preview.item.marketplaceCode,
      listingId: preview.listing ? (preview.listing._id || preview.listing.id) : null,
      listingVariantId: preview.listingVariantId || null,
      internalTemplateId: preview.internalTemplate ? (preview.internalTemplate._id || preview.internalTemplate.id) : null,
      productTypeGroupId: preview.productTypeGroupId || preview.listing?.productTypeGroupId || null,
      vendorProductId: null,
      vendorCostCenterId: null,
      status: fulfillmentPlanStatuses.BLOCKED,
      selectionMode: null,
      blockingReasons: preview.blockingReasons,
      checks: preview.checks,
      snapshot: {
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
        vendorProduct: null,
        vendorCostCenter: null,
        costEstimate: null,
      },
      resolvedBy: null,
      resolvedAt: null,
    });
    await syncWorkbenchFulfillmentPlan(plan);
    if (!options.deferSideEffects) {
      await scheduleFulfillmentSideEffects(orderItemId, preview.item.orderId, {}, authContext);
    }
    if (
      existingPlan?.status !== fulfillmentPlanStatuses.BLOCKED
      || JSON.stringify(existingPlan.blockingReasons || []) !== JSON.stringify(preview.blockingReasons || [])
    ) {
      await orderPublic.appendTimeline({
        orderId: preview.item.orderId,
        orderItemId,
        shopId: preview.item.shopId,
        salesChannelCode: preview.item.salesChannelCode,
        marketplaceCode: preview.item.marketplaceCode,
        eventType: fulfillmentTimelineEvents.PLAN_BLOCKED,
        source: fulfillmentTimelineSources.MAPPING,
        actorId: authContext && authContext.accountId ? authContext.accountId : null,
        metadata: { blockers: preview.blockingReasons || [] },
      });
    }
    return toFulfillmentPlanDto(plan);
  }
  if (isReadyPlan(existingPlan)
    && existingPlan.selectionMode === fulfillmentPlanSelectionModes.AUTO
    && idEquals(existingPlan.vendorProductId, preview.autoMatch.vendorProductId)
    && idEquals(existingPlan.vendorCostCenterId, preview.autoMatch.vendorCostCenterId)) {
    return toFulfillmentPlanDto(existingPlan);
  }
  return persistReadyPlan(orderItemId, {
    vendorProductId: preview.autoMatch.vendorProductId,
    vendorCostCenterId: preview.autoMatch.vendorCostCenterId,
  }, authContext, fulfillmentPlanSelectionModes.AUTO, { ...options, createMissingListing: true, preview });
}

async function recheckFulfillmentPlan(orderItemId, options = {}, authContext) {
  return resolveFulfillmentPlan(orderItemId, options, authContext);
}

async function recheckBlockedFulfillmentPlansForListingVariant(listingId, productTypeGroupId, authContext = {}) {
  assertValidObjectId(listingId, 'listingId');
  assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  const plans = typeof repository.listPsdRefreshTargetsByListingAndProductType === 'function'
    ? await repository.listPsdRefreshTargetsByListingAndProductType(listingId, productTypeGroupId)
    : await repository.listBlockedByListingAndProductType(listingId, productTypeGroupId);
  const result = { checked: plans.length, resolved: 0, blocked: 0 };
  for (const plan of plans) {
    const rechecked = await recheckFulfillmentPlan(toId(plan.orderItemId), {}, authContext);
    if (rechecked.status === fulfillmentPlanStatuses.READY) result.resolved += 1;
    else result.blocked += 1;
  }
  return result;
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
  const touchedOrderIds = new Set();

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

    const resolved = await recheckFulfillmentPlan(orderItemId, { deferSideEffects: true }, authContext);
    const touchedOrderId = toId(item.orderId) || toId(resolved?.orderId);
    if (touchedOrderId) touchedOrderIds.add(touchedOrderId);
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

  for (const orderId of touchedOrderIds) {
    await orderPublic.updateCostCenterStatusForOrder(orderId);
    await orderPublic.updatePsdStatusForOrder(orderId);
  }

  return result;
}

async function getFulfillmentPlanForOrderItem(orderItemId, authContext) {
  const item = await loadOrderItem(orderItemId);
  assertCanAccessShop(item.shopId, MAPPING_READ, authContext);
  return toFulfillmentPlanDto(await repository.findActiveByOrderItem(orderItemId));
}

async function searchManualVendors(query = {}) {
  return vendorPublic.searchActiveVendors(query);
}

async function listManualVendorProducts(vendorId, { productTypeGroupId } = {}) {
  assertValidObjectId(vendorId, 'vendorId');
  if (productTypeGroupId) assertValidObjectId(productTypeGroupId, 'productTypeGroupId');
  return vendorPublic.listActiveVendorProductsByVendor(vendorId, { productTypeGroupId });
}

async function getManualVendorProductOptions(vendorProductId, query = {}) {
  assertValidObjectId(vendorProductId, 'vendorProductId');
  return vendorPublic.getVendorProductOptions(vendorProductId, query);
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
  listUnmatchedOrderItems,
  parseInternalSku,
  previewFulfillmentPlan,
  recheckFulfillmentPlan,
  recheckBlockedFulfillmentPlansForListingVariant,
  recheckUnmatchedFulfillmentPlans,
  applyFulfillmentSideEffects,
  resolveFulfillmentPlan,
  searchVendorCandidatesForOrderItem,
  searchManualVendors,
  listManualVendorProducts,
  getManualVendorProductOptions,
  selectFulfillmentPlan,
  summarizeMapping,
  getFulfillmentPlanForOrderItem,
  listFulfillmentPlansForOrderItems,
  listFulfillmentPlansByOrderItemIds,
};
