const recordStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

const mappingPermissions = Object.freeze({
  READ: 'MAPPING:READ',
  WRITE: 'MAPPING:WRITE',
});

const mappingScopeTypes = Object.freeze({
  SHOP: 'shop',
});

const semanticRoles = Object.freeze({
  SIZE: 'SIZE',
  COLOR: 'COLOR',
  PRODUCT_TYPE: 'PRODUCT_TYPE',
  STYLE: 'STYLE',
  MATERIAL: 'MATERIAL',
  CUSTOM_TEXT: 'CUSTOM_TEXT',
  CUSTOMER_IMAGE: 'CUSTOMER_IMAGE',
  OTHER: 'OTHER',
});

const matchTargets = Object.freeze({
  LABEL: 'LABEL',
  VALUE: 'VALUE',
  LABEL_AND_VALUE: 'LABEL_AND_VALUE',
});

const matchTypes = Object.freeze({
  EXACT: 'EXACT',
  CONTAINS: 'CONTAINS',
  REGEX: 'REGEX',
});

const skuNormalizePatternTypes = Object.freeze({
  SEGMENT: 'SEGMENT',
});

const skuNormalizeSegmentRoles = Object.freeze({
  EMPLOYEE: 'EMPLOYEE',
  SIZE: 'SIZE',
  COLOR: 'COLOR',
  CONFIG: 'CONFIG',
  COUNTRY: 'COUNTRY',
  OTHER: 'OTHER',
});

const skuNormalizeOutputActions = Object.freeze({
  REMOVE_SEGMENT: 'REMOVE_SEGMENT',
  REPLACE_SEGMENT: 'REPLACE_SEGMENT',
});

const inputSources = Object.freeze({
  RULE: 'RULE',
  SKU_CONFIG: 'SKU_CONFIG',
  TEMPLATE_METADATA: 'TEMPLATE_METADATA',
  HEURISTIC: 'HEURISTIC',
});

const confidenceLevels = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

const normalizationPatterns = Object.freeze({
  OUT_OF_STOCK: /out\s*of\s*stock/i,
  PARENTHETICAL: /\(([^)]*)\)/g,
  WHITESPACE: /\s+/g,
  DIMENSION_UNITS: /INCHES|INCH|IN|["']/g,
  DIMENSION_MULTIPLY: /[*×]/g,
  DIMENSION_SIZE: /(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)/,
});

const normalizationSeparators = Object.freeze({
  PRODUCT_COLOR: '/',
});

const ruleSpecificityFields = Object.freeze([
  'shopId',
  'salesChannelCode',
  'marketplaceCode',
  'productTypeGroupId',
  'asin',
  'configCode',
  'normalizedSize',
  'normalizedColor',
]);

const semanticLabelKeywords = Object.freeze({
  [semanticRoles.SIZE]: ['size'],
  [semanticRoles.COLOR]: ['color', 'colour', 'pack'],
  [semanticRoles.PRODUCT_TYPE]: ['product type', 'product'],
  [semanticRoles.STYLE]: ['style'],
  [semanticRoles.MATERIAL]: ['material'],
  [semanticRoles.CUSTOMER_IMAGE]: ['image', 'photo'],
  [semanticRoles.CUSTOM_TEXT]: ['text', 'name'],
});

const normalizationReasons = Object.freeze({
  RULE: 'NORMALIZATION_RULE',
  RULE_WITH_ANNOTATION: 'NORMALIZATION_RULE_WITH_ANNOTATION',
  COMBINED_PRODUCT_COLOR: 'COMBINED_PRODUCT_COLOR',
  COMBINED_PRODUCT_COLOR_WITH_ANNOTATION: 'COMBINED_PRODUCT_COLOR_WITH_ANNOTATION',
  DIMENSION_SIZE_HEURISTIC: 'DIMENSION_SIZE_HEURISTIC',
  LABEL_HEURISTIC: 'LABEL_HEURISTIC',
  LABEL_HEURISTIC_WITH_ANNOTATION: 'LABEL_HEURISTIC_WITH_ANNOTATION',
  INTERNAL_TEMPLATE_SEMANTIC_ROLE: 'INTERNAL_TEMPLATE_SEMANTIC_ROLE',
  SKU_CONFIG_KEY_BUCKET: 'SKU_CONFIG_KEY_BUCKET',
});

const mappingBlockingReasons = Object.freeze({
  SELECTED_OPTION_OUT_OF_STOCK: 'SELECTED_OPTION_OUT_OF_STOCK',
  TEMPLATE_REQUIRED_INPUT_MISSING: 'TEMPLATE_REQUIRED_INPUT_MISSING',
});

module.exports = {
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
  skuNormalizeOutputActions,
  skuNormalizePatternTypes,
  skuNormalizeSegmentRoles,
};
