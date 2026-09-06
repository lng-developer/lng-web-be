function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toNormalizationRuleDto(rule) {
  if (!rule) return null;
  return {
    id: toId(rule),
    shopId: toId(rule.shopId),
    salesChannelCode: rule.salesChannelCode || null,
    marketplaceCode: rule.marketplaceCode || null,
    productTypeGroupId: toId(rule.productTypeGroupId),
    semanticRole: rule.semanticRole,
    matchTarget: rule.matchTarget,
    matchType: rule.matchType,
    matchValue: rule.matchValue,
    matchValues: Array.isArray(rule.matchValues) && rule.matchValues.length
      ? rule.matchValues
      : rule.matchValue ? [rule.matchValue] : [],
    normalizedValue: rule.normalizedValue || null,
    priority: rule.priority ?? 100,
    status: rule.status,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function toVendorRoutingRuleDto(rule) {
  if (!rule) return null;
  return {
    id: toId(rule),
    shopId: toId(rule.shopId),
    salesChannelCode: rule.salesChannelCode || null,
    marketplaceCode: rule.marketplaceCode || null,
    productTypeGroupId: toId(rule.productTypeGroupId),
    vendorId: toId(rule.vendorId),
    asin: rule.asin || null,
    configCode: rule.configCode || null,
    normalizedSize: rule.normalizedSize || null,
    normalizedColor: rule.normalizedColor || null,
    priority: rule.priority ?? 100,
    status: rule.status,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function toSkuConfigRuleDto(rule) {
  if (!rule) return null;
  return {
    id: toId(rule),
    shopId: toId(rule.shopId),
    salesChannelCode: rule.salesChannelCode || null,
    marketplaceCode: rule.marketplaceCode || null,
    configCode: rule.configCode,
    productTypeAliases: rule.productTypeAliases || [],
    platformProductType: rule.platformProductType || null,
    countryCode: rule.countryCode || null,
    combinationProductTypeKey: rule.combinationProductTypeKey || null,
    sizeKeys: rule.sizeKeys || [],
    colorKeys: rule.colorKeys || [],
    productTypeKeys: rule.productTypeKeys || [],
    productTypeColorKeys: rule.productTypeColorKeys || [],
    productTypeSizeKeys: rule.productTypeSizeKeys || [],
    combinationKeys: rule.combinationKeys || [],
    attributeKeyMap: rule.attributeKeyMap || {},
    defaultColor: rule.defaultColor || null,
    isSet: Boolean(rule.isSet),
    isPack: Boolean(rule.isPack),
    sizePosition: rule.sizePosition ?? 0,
    colorPosition: rule.colorPosition ?? 0,
    productTypeGroupId: toId(rule.productTypeGroupId),
    internalTemplateId: toId(rule.internalTemplateId),
    priority: rule.priority ?? 100,
    status: rule.status,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function toSkuNormalizeRuleDto(rule) {
  if (!rule) return null;
  return {
    id: toId(rule),
    shopId: toId(rule.shopId),
    salesChannelCode: rule.salesChannelCode || null,
    marketplaceCode: rule.marketplaceCode || null,
    configCode: rule.configCode || null,
    patternType: rule.patternType,
    segmentIndex: rule.segmentIndex,
    segmentRole: rule.segmentRole,
    appliesWhenValues: rule.appliesWhenValues || [],
    outputAction: rule.outputAction,
    replacementValue: rule.replacementValue || null,
    priority: rule.priority ?? 100,
    status: rule.status,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function toRulePreviewDto(ruleType, samples) {
  return { ruleType, samples, diagnostics: [] };
}

function toRuleConflictDto(rule, severity, reason) {
  return {
    id: toId(rule),
    severity,
    reason,
    priority: rule.priority ?? 100,
    status: rule.status,
  };
}

function toPaginatedResponse(result, mapper) {
  return {
    items: (result.items || []).map(mapper),
    pagination: result.pagination,
  };
}

module.exports = {
  toNormalizationRuleDto,
  toPaginatedResponse,
  toRuleConflictDto,
  toRulePreviewDto,
  toSkuConfigRuleDto,
  toSkuNormalizeRuleDto,
  toVendorRoutingRuleDto,
};
