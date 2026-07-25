const { skuSeparators } = require('../constants/fulfillmentPlan.constants');
const {
  skuNormalizeOutputActions,
  skuNormalizePatternTypes,
  skuNormalizeSegmentRoles,
} = require('../constants/mappingRule.constants');

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function applySkuNormalizeRules(sku, rules = []) {
  const originalSku = String(sku || '').trim().toUpperCase();
  const originalSegments = originalSku.split(skuSeparators.SEGMENT).filter(Boolean);
  const segments = originalSegments.map((value, originalIndex) => ({ value, originalIndex }));
  const removedSegments = [];
  const replacedSegments = [];
  const appliedRuleIds = [];

  [...rules].sort((left, right) => {
    const leftMatchesConfig = left.configCode
      && originalSegments.includes(String(left.configCode).trim().toUpperCase());
    const rightMatchesConfig = right.configCode
      && originalSegments.includes(String(right.configCode).trim().toUpperCase());
    if (Boolean(leftMatchesConfig) !== Boolean(rightMatchesConfig)) return rightMatchesConfig ? 1 : -1;
    return (left.priority || 100) - (right.priority || 100);
  }).forEach((rule) => {
    if (rule.patternType !== skuNormalizePatternTypes.SEGMENT) return;
    if (rule.configCode && !originalSegments.includes(String(rule.configCode).trim().toUpperCase())) return;
    const index = Number(rule.segmentIndex);
    const segment = segments.find((candidate) => candidate.originalIndex === index);
    const value = segment && segment.value;
    const matches = (rule.appliesWhenValues || []).map((item) => String(item || '').trim().toUpperCase());
    if (!value || !matches.includes(value)) return;
    if (rule.outputAction === skuNormalizeOutputActions.REMOVE_SEGMENT) {
      removedSegments.push({ index, value, role: rule.segmentRole || skuNormalizeSegmentRoles.OTHER });
      appliedRuleIds.push(toId(rule));
      segments.splice(segments.indexOf(segment), 1);
      return;
    }
    if (rule.outputAction === skuNormalizeOutputActions.REPLACE_SEGMENT) {
      const replacementValue = String(rule.replacementValue || '').trim().toUpperCase();
      if (!replacementValue || replacementValue === value) return;
      replacedSegments.push({ index, from: value, to: replacementValue, role: rule.segmentRole || skuNormalizeSegmentRoles.OTHER });
      appliedRuleIds.push(toId(rule));
      segment.value = replacementValue;
    }
  });

  return {
    originalSku,
    canonicalSku: segments.map((segment) => segment.value).join(skuSeparators.SEGMENT) || originalSku,
    appliedRuleIds,
    removedSegments,
    replacedSegments,
  };
}

module.exports = { applySkuNormalizeRules };
