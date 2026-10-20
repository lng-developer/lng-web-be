const Joi = require('joi');
const {
  workScoreLevels,
  workScoreRuleStatuses,
  workScoreSourceTypes,
  workScoreStatuses,
} = require('../constants/workScore.constants');

const objectId = Joi.string().hex().length(24);
const reason = Joi.string().trim().min(2).max(500);

const listQuerySchema = Joi.object({
  search: Joi.string().trim().max(200),
  sourceType: Joi.string().trim().uppercase().valid(...Object.values(workScoreSourceTypes)),
  shopId: objectId,
  workerId: objectId,
  taskType: Joi.string().trim().uppercase().max(100),
  scaleDifficultyLevel: Joi.string().trim().uppercase().valid('NORMAL', 'HARD', 'SPECIAL'),
  scoreLevel: Joi.string().trim().uppercase().valid(...Object.values(workScoreLevels)),
  scoreStatus: Joi.string().trim().uppercase().valid(...Object.values(workScoreStatuses), 'ALL'),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().valid('scoredAt', 'finalPoints', 'updatedAt').default('scoredAt'),
  sortOrder: Joi.string().lowercase().valid('asc', 'desc').default('desc'),
}).custom((value, helpers) => (
  value.dateFrom && value.dateTo && new Date(value.dateFrom) > new Date(value.dateTo)
    ? helpers.error('any.invalid')
    : value
));

const scoreParamsSchema = Joi.object({ scoreId: objectId.required() });
const overrideSchema = Joi.object({
  points: Joi.number().min(0).required(),
  scoreLevel: Joi.string().trim().uppercase().valid(...Object.values(workScoreLevels)),
  reason: reason.required(),
  expectedVersion: Joi.number().integer().min(0).required(),
});
const voidSchema = Joi.object({
  reason: reason.required(),
  expectedVersion: Joi.number().integer().min(0).required(),
});
const ruleSchema = Joi.object({
  sourceType: Joi.string().trim().uppercase().valid(...Object.values(workScoreSourceTypes)).required(),
  taskType: Joi.string().trim().uppercase().max(100).allow(null, ''),
  priority: Joi.string().trim().uppercase().max(40).allow(null, ''),
  slotKey: Joi.any().forbidden(),
  scaleDifficultyLevel: Joi.string().trim().uppercase().valid('NORMAL', 'HARD', 'SPECIAL').allow(null, ''),
  points: Joi.number().min(0).required(),
  status: Joi.string().trim().uppercase().valid(...Object.values(workScoreRuleStatuses)).default(workScoreRuleStatuses.ACTIVE),
}).custom((value, helpers) => {
  if (value.sourceType === workScoreSourceTypes.DESIGN_SUBMISSION) {
    if (!value.taskType) return helpers.message('taskType is required for DESIGN_SUBMISSION rules');
    if (value.scaleDifficultyLevel) return helpers.message('scaleDifficultyLevel is only supported for PRODUCTION_SCALE rules');
  }
  if (value.sourceType === workScoreSourceTypes.PRODUCTION_SCALE && (value.taskType || value.priority)) {
    return helpers.message('taskType and priority are not supported for PRODUCTION_SCALE rules');
  }
  return value;
});

function validate(schema, payload) {
  return schema.validate(payload, { abortEarly: false, convert: true, stripUnknown: true });
}

module.exports = { listQuerySchema, overrideSchema, ruleSchema, scoreParamsSchema, validate, voidSchema };
