const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/mappingRule.service');
const {
  createNormalizationRuleSchema,
  createSemanticRuleSchema,
  createSkuConfigRuleSchema,
  createSkuNormalizeRuleSchema,
  createValueAliasSchema,
  createVendorRoutingRuleSchema,
  listNormalizationRulesQuerySchema,
  listSkuConfigRulesQuerySchema,
  listSkuNormalizeRulesQuerySchema,
  listVendorRoutingRulesQuerySchema,
  reorderVendorRoutingRulesSchema,
  ruleEvaluationSchema,
  updateSkuConfigRuleSchema,
  updateSkuNormalizeRuleSchema,
  updateSemanticRuleSchema,
  updateNormalizationRuleSchema,
  updateValueAliasSchema,
  updateVendorRoutingRuleSchema,
} = require('../validators/mappingRule.validator');
const { assertValid } = require('./requestValidation');

async function listNormalizationRules(req, res) {
  const query = assertValid(listNormalizationRulesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listNormalizationRules(query, req.auth),
  });
}

async function listSemanticRules(req, res) {
  const query = assertValid(listNormalizationRulesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listNormalizationRules({ ...query, matchTarget: 'LABEL' }, req.auth),
  });
}

async function listValueAliases(req, res) {
  const query = assertValid(listNormalizationRulesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listNormalizationRules({
      ...query,
      hasNormalizedValue: true,
      matchTarget: 'VALUE',
    }, req.auth),
  });
}

async function getNormalizationRule(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getNormalizationRule(req.params.id, req.auth),
  });
}

async function createNormalizationRule(req, res) {
  const payload = assertValid(createNormalizationRuleSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createNormalizationRule(payload, req.auth),
  });
}

async function createSemanticRule(req, res) {
  const payload = assertValid(createSemanticRuleSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createNormalizationRule(payload, req.auth),
  });
}

async function createValueAlias(req, res) {
  const payload = assertValid(createValueAliasSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createNormalizationRule(payload, req.auth),
  });
}

async function updateNormalizationRule(req, res) {
  const payload = assertValid(updateNormalizationRuleSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateNormalizationRule(req.params.id, payload, req.auth),
  });
}

async function updateSemanticRule(req, res) {
  const payload = assertValid(updateSemanticRuleSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateNormalizationRule(req.params.id, payload, req.auth),
  });
}

async function updateValueAlias(req, res) {
  const payload = assertValid(updateValueAliasSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateNormalizationRule(req.params.id, payload, req.auth),
  });
}

async function listVendorRoutingRules(req, res) {
  const query = assertValid(listVendorRoutingRulesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listVendorRoutingRules(query, req.auth),
  });
}

async function getVendorRoutingRule(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getVendorRoutingRule(req.params.id, req.auth),
  });
}

async function createVendorRoutingRule(req, res) {
  const payload = assertValid(createVendorRoutingRuleSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createVendorRoutingRule(payload, req.auth),
  });
}

async function updateVendorRoutingRule(req, res) {
  const payload = assertValid(updateVendorRoutingRuleSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateVendorRoutingRule(req.params.id, payload, req.auth),
  });
}

async function reorderVendorRoutingRules(req, res) {
  const payload = assertValid(reorderVendorRoutingRulesSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.reorderVendorRoutingRules(payload, req.auth),
  });
}

async function listSkuConfigRules(req, res) {
  const query = assertValid(listSkuConfigRulesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listSkuConfigRules(query, req.auth),
  });
}

async function getSkuConfigRule(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getSkuConfigRule(req.params.id, req.auth),
  });
}

async function createSkuConfigRule(req, res) {
  const payload = assertValid(createSkuConfigRuleSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createSkuConfigRule(payload, req.auth),
  });
}

async function updateSkuConfigRule(req, res) {
  const payload = assertValid(updateSkuConfigRuleSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateSkuConfigRule(req.params.id, payload, req.auth),
  });
}

async function listSkuNormalizeRules(req, res) {
  const query = assertValid(listSkuNormalizeRulesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listSkuNormalizeRules(query, req.auth),
  });
}

async function getSkuNormalizeRule(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getSkuNormalizeRule(req.params.id, req.auth),
  });
}

async function createSkuNormalizeRule(req, res) {
  const payload = assertValid(createSkuNormalizeRuleSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createSkuNormalizeRule(payload, req.auth),
  });
}

async function updateSkuNormalizeRule(req, res) {
  const payload = assertValid(updateSkuNormalizeRuleSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateSkuNormalizeRule(req.params.id, payload, req.auth),
  });
}

async function previewRule(req, res) {
  const payload = assertValid(ruleEvaluationSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.previewRule(payload, req.auth) });
}

async function findRuleConflicts(req, res) {
  const payload = assertValid(ruleEvaluationSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.findRuleConflicts(payload, req.auth) });
}

async function listRuleHistory(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listRuleHistory(req.params.ruleType, req.params.id, req.auth),
  });
}

module.exports = {
  createNormalizationRule,
  createSemanticRule,
  createSkuConfigRule,
  createSkuNormalizeRule,
  createValueAlias,
  createVendorRoutingRule,
  findRuleConflicts,
  getNormalizationRule,
  getSkuConfigRule,
  getSkuNormalizeRule,
  getVendorRoutingRule,
  listSkuConfigRules,
  listSkuNormalizeRules,
  listNormalizationRules,
  listRuleHistory,
  listSemanticRules,
  listValueAliases,
  listVendorRoutingRules,
  previewRule,
  reorderVendorRoutingRules,
  updateSkuConfigRule,
  updateSkuNormalizeRule,
  updateSemanticRule,
  updateNormalizationRule,
  updateValueAlias,
  updateVendorRoutingRule,
};
