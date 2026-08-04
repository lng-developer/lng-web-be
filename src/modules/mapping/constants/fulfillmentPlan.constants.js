const fulfillmentPlanStatuses = Object.freeze({
  DRAFT: 'DRAFT',
  READY: 'READY',
  CONFIRMED: 'CONFIRMED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
});

const fulfillmentPlanSelectionModes = Object.freeze({
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
});

const activeFulfillmentPlanStatuses = Object.freeze([
  fulfillmentPlanStatuses.READY,
  fulfillmentPlanStatuses.CONFIRMED,
  fulfillmentPlanStatuses.BLOCKED,
]);

const fulfillmentCheckStatuses = Object.freeze({
  NOT_CHECKED: 'NOT_CHECKED',
  MISSING: 'MISSING',
  FOUND: 'FOUND',
  NOT_REQUIRED: 'NOT_REQUIRED',
  READY: 'READY',
  NOT_READY: 'NOT_READY',
});

const fulfillmentBlockingReasons = Object.freeze({
  ORDER_ITEM_NOT_FOUND: 'ORDER_ITEM_NOT_FOUND',
  LISTING_NOT_FOUND: 'LISTING_NOT_FOUND',
  LISTING_CONFIGURATION_REQUIRED: 'LISTING_CONFIGURATION_REQUIRED',
  SKU_CONFIG_AMBIGUOUS: 'SKU_CONFIG_AMBIGUOUS',
  INTERNAL_TEMPLATE_NOT_FOUND: 'INTERNAL_TEMPLATE_NOT_FOUND',
  CUSTOMIZATION_NOT_READY: 'CUSTOMIZATION_NOT_READY',
  NO_VENDOR_PRODUCT_CANDIDATE: 'NO_VENDOR_PRODUCT_CANDIDATE',
  NO_VENDOR_COST_CENTER_CANDIDATE: 'NO_VENDOR_COST_CENTER_CANDIDATE',
  PLAN_ALREADY_CONFIRMED: 'PLAN_ALREADY_CONFIRMED',
  PLAN_ALREADY_RESOLVED: 'PLAN_ALREADY_RESOLVED',
  SELECTED_VENDOR_PRODUCT_INVALID: 'SELECTED_VENDOR_PRODUCT_INVALID',
  SELECTED_VENDOR_COST_CENTER_INVALID: 'SELECTED_VENDOR_COST_CENTER_INVALID',
});

const costCenterMatchReasons = Object.freeze({
  SKU_EXACT: 'SKU_EXACT',
  LNG_CODE_EXACT: 'LNG_CODE_EXACT',
  STANDARD_SIZE: 'STANDARD_SIZE',
  STANDARD_COLOR: 'STANDARD_COLOR',
  VENDOR_SIZE: 'VENDOR_SIZE',
  VENDOR_COLOR: 'VENDOR_COLOR',
  ATTR_SIZE: 'ATTR_SIZE',
  ATTR_COLOR: 'ATTR_COLOR',
});

const skuSeparators = Object.freeze({
  SEGMENT: '-',
});

const costCenterNormalizationPatterns = Object.freeze({
  DIMENSION_UNITS: /INCHES|INCH|IN|["']/g,
  DIMENSION_MULTIPLY: /[*×]/g,
  WHITESPACE: /\s+/g,
  NON_ALNUM_DECIMAL: /[^A-Z0-9.]+/g,
  PACK_PCS: /\bPACK\s*(\d+(?:\.\d+)?)\s*PCS\b/,
  PCS: /\b(\d+(?:\.\d+)?)\s*PCS\b/,
});

const productTypeCodeReplacements = Object.freeze([
  ['COLORS', 'COLOR'],
  ['COLOURS', 'COLOR'],
  ['COLOUR', 'COLOR'],
  ['T_SHIRT', 'TSHIRT'],
  ['TSHIRT', 'T_SHIRT'],
]);

const fulfillmentTimelineEvents = Object.freeze({
  PLAN_READY: 'FULFILLMENT_PLAN_READY',
  MANUAL_VENDOR_MATCHED: 'MANUAL_VENDOR_MATCHED',
});

const fulfillmentTimelineSources = Object.freeze({
  MAPPING: 'MAPPING',
});

module.exports = {
  activeFulfillmentPlanStatuses,
  costCenterNormalizationPatterns,
  costCenterMatchReasons,
  fulfillmentBlockingReasons,
  fulfillmentCheckStatuses,
  fulfillmentPlanSelectionModes,
  fulfillmentPlanStatuses,
  fulfillmentTimelineEvents,
  fulfillmentTimelineSources,
  productTypeCodeReplacements,
  skuSeparators,
};
