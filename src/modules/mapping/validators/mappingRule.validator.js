const Joi = require('joi');
const {
  matchTargets,
  matchTypes,
  recordStatuses,
  semanticRoles,
  skuNormalizeOutputActions,
  skuNormalizePatternTypes,
  skuNormalizeSegmentRoles,
} = require('../constants/mappingRule.constants');
const { objectId, optionalObjectId } = require('./fulfillmentPlan.validator');

const paginationQuery = {
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
};

const normalizationRuleBody = {
  shopId: optionalObjectId,
  salesChannelCode: Joi.string().trim().max(40).allow(null, ''),
  marketplaceCode: Joi.string().trim().max(40).allow(null, ''),
  productTypeGroupId: optionalObjectId,
  semanticRole: Joi.string().valid(...Object.values(semanticRoles)).required(),
  matchTarget: Joi.string().valid(...Object.values(matchTargets)).required(),
  matchType: Joi.string().valid(...Object.values(matchTypes)).required(),
  matchValue: Joi.string().trim().max(200).required(),
  normalizedValue: Joi.string().trim().max(200).allow(null, ''),
  priority: Joi.number().integer().min(0),
  status: Joi.string().valid(...Object.values(recordStatuses)),
};

const semanticRuleBody = {
  ...normalizationRuleBody,
  matchTarget: Joi.string().valid(...Object.values(matchTargets)).default(matchTargets.LABEL),
  matchType: Joi.string().valid(...Object.values(matchTypes)).default(matchTypes.CONTAINS),
};

const valueAliasBody = {
  ...normalizationRuleBody,
  matchTarget: Joi.string().valid(...Object.values(matchTargets)).default(matchTargets.VALUE),
  matchType: Joi.string().valid(...Object.values(matchTypes)).default(matchTypes.EXACT),
  normalizedValue: Joi.string().trim().max(200).required(),
};

const vendorRoutingRuleBody = {
  shopId: optionalObjectId,
  salesChannelCode: Joi.string().trim().max(40).allow(null, ''),
  marketplaceCode: Joi.string().trim().max(40).allow(null, ''),
  productTypeGroupId: objectId.required(),
  vendorId: objectId.required(),
  asin: Joi.string().trim().uppercase().max(40).allow(null, ''),
  configCode: Joi.string().trim().uppercase().max(40).allow(null, ''),
  normalizedSize: Joi.string().trim().uppercase().max(80).allow(null, ''),
  normalizedColor: Joi.string().trim().uppercase().max(120).allow(null, ''),
  priority: Joi.number().integer().min(0),
  status: Joi.string().valid(...Object.values(recordStatuses)),
};

const skuConfigRuleBody = {
  shopId: optionalObjectId,
  salesChannelCode: Joi.string().trim().max(40).allow(null, ''),
  marketplaceCode: Joi.string().trim().max(40).allow(null, ''),
  configCode: Joi.string().trim().uppercase().max(40).required(),
  productTypeAliases: Joi.array().items(Joi.string().trim().max(200)).default([]),
  platformProductType: Joi.string().trim().max(200).allow(null, ''),
  countryCode: Joi.string().trim().uppercase().max(10).allow(null, ''),
  combinationProductTypeKey: Joi.string().trim().max(120).allow(null, ''),
  sizeKeys: Joi.array().items(Joi.string().trim().max(120)).default([]),
  colorKeys: Joi.array().items(Joi.string().trim().max(120)).default([]),
  productTypeKeys: Joi.array().items(Joi.string().trim().max(120)).default([]),
  productTypeColorKeys: Joi.array().items(Joi.string().trim().max(120)).default([]),
  productTypeSizeKeys: Joi.array().items(Joi.string().trim().max(120)).default([]),
  combinationKeys: Joi.array().items(Joi.string().trim().max(120)).default([]),
  attributeKeyMap: Joi.object().unknown(true).default({}),
  defaultColor: Joi.string().trim().uppercase().max(120).allow(null, ''),
  isSet: Joi.boolean(),
  isPack: Joi.boolean(),
  sizePosition: Joi.number().integer().min(0),
  colorPosition: Joi.number().integer().min(0),
  productTypeGroupId: objectId.required(),
  internalTemplateId: optionalObjectId,
  priority: Joi.number().integer().min(0),
  status: Joi.string().valid(...Object.values(recordStatuses)),
};

const skuNormalizeRuleBody = {
  shopId: optionalObjectId,
  salesChannelCode: Joi.string().trim().max(40).allow(null, ''),
  marketplaceCode: Joi.string().trim().max(40).allow(null, ''),
  configCode: Joi.string().trim().uppercase().max(40).allow(null, ''),
  patternType: Joi.string().valid(...Object.values(skuNormalizePatternTypes)).required(),
  segmentIndex: Joi.number().integer().min(0).required(),
  segmentRole: Joi.string().valid(...Object.values(skuNormalizeSegmentRoles)).required(),
  appliesWhenValues: Joi.array().min(1).items(Joi.string().trim().max(40)).required(),
  outputAction: Joi.string().valid(...Object.values(skuNormalizeOutputActions)).required(),
  replacementValue: Joi.string().trim().uppercase().max(80).allow(null, ''),
  priority: Joi.number().integer().min(0),
  status: Joi.string().valid(...Object.values(recordStatuses)),
};

const listNormalizationRulesQuerySchema = Joi.object({
  ...paginationQuery,
  shopId: objectId,
  salesChannelCode: Joi.string().trim().max(40),
  marketplaceCode: Joi.string().trim().max(40),
  productTypeGroupId: objectId,
  semanticRole: Joi.string().valid(...Object.values(semanticRoles)),
  status: Joi.string().valid(...Object.values(recordStatuses)),
});

const createNormalizationRuleSchema = Joi.object(normalizationRuleBody);
const updateNormalizationRuleSchema = Joi.object({
  ...normalizationRuleBody,
  semanticRole: normalizationRuleBody.semanticRole.optional(),
  matchTarget: normalizationRuleBody.matchTarget.optional(),
  matchType: normalizationRuleBody.matchType.optional(),
  matchValue: normalizationRuleBody.matchValue.optional(),
}).min(1);
const createSemanticRuleSchema = Joi.object(semanticRuleBody);
const updateSemanticRuleSchema = Joi.object({
  ...semanticRuleBody,
  semanticRole: semanticRuleBody.semanticRole.optional(),
  matchTarget: semanticRuleBody.matchTarget.optional(),
  matchType: semanticRuleBody.matchType.optional(),
  matchValue: semanticRuleBody.matchValue.optional(),
}).min(1);
const createValueAliasSchema = Joi.object(valueAliasBody);
const updateValueAliasSchema = Joi.object({
  ...valueAliasBody,
  semanticRole: valueAliasBody.semanticRole.optional(),
  matchTarget: valueAliasBody.matchTarget.optional(),
  matchType: valueAliasBody.matchType.optional(),
  matchValue: valueAliasBody.matchValue.optional(),
  normalizedValue: valueAliasBody.normalizedValue.optional(),
}).min(1);

const listVendorRoutingRulesQuerySchema = Joi.object({
  ...paginationQuery,
  shopId: objectId,
  salesChannelCode: Joi.string().trim().max(40),
  marketplaceCode: Joi.string().trim().max(40),
  productTypeGroupId: objectId,
  vendorId: objectId,
  asin: Joi.string().trim().uppercase().max(40),
  configCode: Joi.string().trim().uppercase().max(40),
  normalizedSize: Joi.string().trim().uppercase().max(80),
  normalizedColor: Joi.string().trim().uppercase().max(120),
  status: Joi.string().valid(...Object.values(recordStatuses)),
});

const listSkuConfigRulesQuerySchema = Joi.object({
  ...paginationQuery,
  shopId: objectId,
  salesChannelCode: Joi.string().trim().max(40),
  marketplaceCode: Joi.string().trim().max(40),
  configCode: Joi.string().trim().uppercase().max(40),
  countryCode: Joi.string().trim().uppercase().max(10),
  productTypeGroupId: objectId,
  status: Joi.string().valid(...Object.values(recordStatuses)),
});

const listSkuNormalizeRulesQuerySchema = Joi.object({
  ...paginationQuery,
  shopId: objectId,
  salesChannelCode: Joi.string().trim().max(40),
  marketplaceCode: Joi.string().trim().max(40),
  configCode: Joi.string().trim().uppercase().max(40),
  patternType: Joi.string().valid(...Object.values(skuNormalizePatternTypes)),
  segmentRole: Joi.string().valid(...Object.values(skuNormalizeSegmentRoles)),
  status: Joi.string().valid(...Object.values(recordStatuses)),
});

const createVendorRoutingRuleSchema = Joi.object(vendorRoutingRuleBody);
const updateVendorRoutingRuleSchema = Joi.object({
  ...vendorRoutingRuleBody,
  productTypeGroupId: vendorRoutingRuleBody.productTypeGroupId.optional(),
  vendorId: vendorRoutingRuleBody.vendorId.optional(),
}).min(1);
const reorderVendorRoutingRulesSchema = Joi.object({
  shopId: optionalObjectId,
  salesChannelCode: Joi.string().trim().max(40).allow(null, ''),
  marketplaceCode: Joi.string().trim().max(40).allow(null, ''),
  productTypeGroupId: objectId.required(),
  vendorRanks: Joi.array().min(1).items(Joi.object({
    vendorId: objectId.required(),
    priority: Joi.number().integer().min(0).required(),
  })).required(),
});
const createSkuConfigRuleSchema = Joi.object(skuConfigRuleBody);
const updateSkuConfigRuleSchema = Joi.object({
  ...skuConfigRuleBody,
  configCode: skuConfigRuleBody.configCode.optional(),
  productTypeGroupId: skuConfigRuleBody.productTypeGroupId.optional(),
}).min(1);
function requireReplacementValue(value, helpers) {
  if (
    value.outputAction === skuNormalizeOutputActions.REPLACE_SEGMENT
    && !String(value.replacementValue || '').trim()
  ) {
    return helpers.error('any.custom', { message: 'replacementValue is required for REPLACE_SEGMENT' });
  }
  return value;
}

const createSkuNormalizeRuleSchema = Joi.object(skuNormalizeRuleBody).custom(requireReplacementValue);
const updateSkuNormalizeRuleSchema = Joi.object({
  ...skuNormalizeRuleBody,
  patternType: skuNormalizeRuleBody.patternType.optional(),
  segmentIndex: skuNormalizeRuleBody.segmentIndex.optional(),
  segmentRole: skuNormalizeRuleBody.segmentRole.optional(),
  appliesWhenValues: skuNormalizeRuleBody.appliesWhenValues.optional(),
  outputAction: skuNormalizeRuleBody.outputAction.optional(),
}).min(1).custom(requireReplacementValue);

const ruleEvaluationSchema = Joi.object({
  ruleId: optionalObjectId,
  ruleType: Joi.string().valid('skuNormalize', 'skuConfig', 'semanticRules', 'valueAliases').required(),
  rule: Joi.alternatives().conditional('ruleType', {
    switch: [
      { is: 'skuNormalize', then: createSkuNormalizeRuleSchema },
      { is: 'skuConfig', then: createSkuConfigRuleSchema },
      { is: 'semanticRules', then: createSemanticRuleSchema },
      { is: 'valueAliases', then: createValueAliasSchema },
    ],
  }).required(),
  samples: Joi.array().items(Joi.string().trim().max(200)).max(10).default([]),
});

module.exports = {
  createNormalizationRuleSchema,
  createSemanticRuleSchema,
  createSkuConfigRuleSchema,
  createSkuNormalizeRuleSchema,
  createValueAliasSchema,
  createVendorRoutingRuleSchema,
  listSkuConfigRulesQuerySchema,
  listSkuNormalizeRulesQuerySchema,
  listNormalizationRulesQuerySchema,
  listVendorRoutingRulesQuerySchema,
  reorderVendorRoutingRulesSchema,
  ruleEvaluationSchema,
  updateSkuConfigRuleSchema,
  updateSkuNormalizeRuleSchema,
  updateSemanticRuleSchema,
  updateNormalizationRuleSchema,
  updateValueAliasSchema,
  updateVendorRoutingRuleSchema,
};
