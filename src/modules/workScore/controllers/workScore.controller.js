const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/workScore.service');
const { toWorkScoreDto } = require('../dtos/workScore.dto');
const {
  listQuerySchema,
  overrideSchema,
  ruleSchema,
  scoreParamsSchema,
  validate,
  voidSchema,
} = require('../validators/workScore.validator');

function assertValid(schema, payload) {
  const { error, value } = validate(schema, payload);
  if (error) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, error.details);
  return value;
}

function send(res, data) {
  res.status(httpStatus.OK).json({ success: true, data });
}

async function listScores(req, res) {
  const result = await service.listScores(assertValid(listQuerySchema, req.query), req.auth);
  send(res, { ...result, items: result.items.map(toWorkScoreDto) });
}

async function summarizeScores(req, res) {
  send(res, await service.summarizeScores(assertValid(listQuerySchema, req.query), req.auth));
}

async function getScore(req, res) {
  const { scoreId } = assertValid(scoreParamsSchema, req.params);
  send(res, toWorkScoreDto(await service.getScore(scoreId, req.auth)));
}

async function listRules(req, res) {
  send(res, await service.listRules(req.auth));
}

async function upsertRule(req, res) {
  send(res, await service.upsertRule(assertValid(ruleSchema, req.body), req.auth));
}

async function overrideScore(req, res) {
  const { scoreId } = assertValid(scoreParamsSchema, req.params);
  send(res, toWorkScoreDto(await service.overrideScore(scoreId, assertValid(overrideSchema, req.body), req.auth)));
}

async function voidScore(req, res) {
  const { scoreId } = assertValid(scoreParamsSchema, req.params);
  send(res, toWorkScoreDto(await service.voidScore(scoreId, assertValid(voidSchema, req.body), req.auth)));
}

module.exports = { getScore, listRules, listScores, overrideScore, summarizeScores, upsertRule, voidScore };
