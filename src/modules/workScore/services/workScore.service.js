const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const repository = require('../repositories/workScore.repository');
const ruleRepository = require('../repositories/workScoreRule.repository');
const authPublic = require('../../auth/public');
const hrPublic = require('../../hr/public');
const organizationPublic = require('../../organization/public');
const {
  workScoreAdjustmentTypes,
  workScoreLevels,
  workScoreSourceTypes,
  workScoreStatuses,
} = require('../constants/workScore.constants');

const DESIGN_POINTS = Object.freeze({ PSD_TEMPLATE: 3, PNG_ASSET: 1, MOCKUP: 1, IDEA: 2, CLONE: 1 });
const PRIORITY_MULTIPLIER = Object.freeze({ LOW: 1, NORMAL: 1, HIGH: 1.25, URGENT: 1.5 });

function fail(message, statusCode = httpStatus.BAD_REQUEST, code = errorCodes.VALIDATION_ERROR) {
  throw new AppError(message, statusCode, true, code);
}

function assertRequired(input, fields) {
  for (const field of fields) if (!input?.[field]) fail(`${field} is required`);
}

function designPoints(taskType, priority = 'NORMAL') {
  const basePoints = DESIGN_POINTS[taskType] || 1;
  const multiplier = PRIORITY_MULTIPLIER[priority] || 1;
  return {
    basePoints,
    finalPoints: Math.round(basePoints * multiplier * 100) / 100,
    scoreLevel: multiplier > 1 ? workScoreLevels.HARD : workScoreLevels.STANDARD,
    ruleSnapshot: { taskType, priority, basePoints, multiplier },
  };
}

function cleanRuleKey(value) {
  const text = String(value || '').trim().toUpperCase();
  return text || null;
}

function scoreLevelFor(points, sourceType, scaleDifficultyLevel = null) {
  if (sourceType === workScoreSourceTypes.PRODUCTION_SCALE && ['HARD', 'SPECIAL'].includes(scaleDifficultyLevel)) {
    return workScoreLevels.HARD;
  }
  if (Number(points) <= 1) return workScoreLevels.BASIC;
  return workScoreLevels.STANDARD;
}

function toRuleDto(rule) {
  if (!rule) return null;
  return {
    id: String(rule._id || rule.id),
    sourceType: rule.sourceType,
    taskType: rule.taskType || null,
    priority: rule.priority || null,
    scaleDifficultyLevel: rule.scaleDifficultyLevel || null,
    points: rule.points,
    status: rule.status,
  };
}

async function configuredDesignPoints(taskType, priority = 'NORMAL') {
  const sourceType = workScoreSourceTypes.DESIGN_SUBMISSION;
  const task = cleanRuleKey(taskType);
  const level = cleanRuleKey(priority);
  const rule = await ruleRepository.findActive({
    sourceType,
    taskType: task,
    priority: level,
    scaleDifficultyLevel: null,
  }) || await ruleRepository.findActive({
    sourceType,
    taskType: task,
    priority: null,
    scaleDifficultyLevel: null,
  });
  if (!rule) return designPoints(taskType, priority);
  return {
    basePoints: rule.points,
    finalPoints: rule.points,
    scoreLevel: scoreLevelFor(rule.points, sourceType),
    ruleSnapshot: { source: 'CONFIG', ruleId: String(rule._id), taskType: task, priority: level },
  };
}

async function configuredScalePoints(scaleDifficultyLevel) {
  const sourceType = workScoreSourceTypes.PRODUCTION_SCALE;
  const level = cleanRuleKey(scaleDifficultyLevel) || 'NORMAL';
  const rule = await ruleRepository.findActive({
    sourceType,
    taskType: null,
    priority: null,
    scaleDifficultyLevel: level,
  }) || await ruleRepository.findActive({
    sourceType,
    taskType: null,
    priority: null,
    scaleDifficultyLevel: null,
  });
  if (!rule) return { basePoints: 1, finalPoints: 1, scoreLevel: workScoreLevels.STANDARD, ruleSnapshot: { pointsPerPassingOutput: 1 } };
  return {
    basePoints: rule.points,
    finalPoints: rule.points,
    scoreLevel: scoreLevelFor(rule.points, sourceType, level),
    ruleSnapshot: { source: 'CONFIG', ruleId: String(rule._id), scaleDifficultyLevel: level },
  };
}

function workerSnapshot(input = {}) {
  return {
    workerName: input.workerName || null,
    teamId: input.teamId || null,
    teamName: input.teamName || null,
    departmentId: input.departmentId || null,
    departmentName: input.departmentName || null,
  };
}

async function loadWorkerSnapshot(input = {}) {
  if (input.workerName || input.teamId || input.departmentId) return workerSnapshot(input);
  const [profiles, organizations] = await Promise.all([
    hrPublic.listEmployeeProfilesByAccountIds([input.workerId]),
    organizationPublic.listAccountOrganizationSummaries([input.workerId]),
  ]);
  const profile = profiles?.find((row) => String(row.accountId) === String(input.workerId)) || profiles?.[0] || {};
  const organization = organizations?.find((row) => String(row.accountId) === String(input.workerId)) || organizations?.[0] || {};
  return {
    workerName: profile.fullName || null,
    teamId: organization.team?.id || null,
    teamName: organization.team?.name || null,
    departmentId: organization.department?.id || null,
    departmentName: organization.department?.name || null,
  };
}

async function recordDesignSubmissionScore(input = {}) {
  assertRequired(input, ['designTaskId', 'submissionId', 'assetId', 'shopId', 'workerId', 'taskType']);
  const [snapshot, points] = await Promise.all([
    loadWorkerSnapshot(input),
    configuredDesignPoints(input.taskType, input.priority),
  ]);
  return repository.upsertSourceScore({
    sourceType: workScoreSourceTypes.DESIGN_SUBMISSION,
    sourceTaskId: input.designTaskId,
    sourceUnitId: input.submissionId,
    assetId: input.assetId,
    shopId: input.shopId,
    workerId: input.workerId,
    ...snapshot,
    contextSnapshot: input.contextSnapshot || { taskType: input.taskType, priority: input.priority || 'NORMAL' },
    ...points,
    status: workScoreStatuses.ACTIVE,
    scoredBy: input.scoredBy || null,
    scoredAt: input.scoredAt || new Date(),
  });
}

async function recordProductionScaleScores(input = {}) {
  assertRequired(input, ['productionTaskId', 'shopId']);
  if (!Array.isArray(input.outputs)) fail('outputs must be an array');
  const snapshots = new Map();
  await Promise.all([...new Set(input.outputs.map((output) => output.workerId).filter(Boolean))].map(async (workerId) => {
    snapshots.set(String(workerId), await loadWorkerSnapshot({ workerId }));
  }));
  return Promise.all(input.outputs.map(async (output) => {
    assertRequired(output, ['fileCheckId', 'assetId', 'workerId']);
    const points = await configuredScalePoints(output.contextSnapshot?.scaleDifficultyLevel);
    return repository.upsertSourceScore({
      sourceType: workScoreSourceTypes.PRODUCTION_SCALE,
      sourceTaskId: input.productionTaskId,
      sourceUnitId: output.fileCheckId,
      assetId: output.assetId,
      shopId: input.shopId,
      workerId: output.workerId,
      ...(output.workerName || output.teamId || output.departmentId
        ? workerSnapshot(output)
        : snapshots.get(String(output.workerId))),
      contextSnapshot: { ...(input.contextSnapshot || {}), ...(output.contextSnapshot || {}) },
      ...points,
      status: workScoreStatuses.ACTIVE,
      scoredBy: input.scoredBy || null,
      scoredAt: output.scoredAt || input.scoredAt || new Date(),
    });
  }));
}

async function listRules(auth = {}) {
  if (!hasGlobal(auth, 'WORK_SCORES:ADJUST')) forbidden();
  return (await ruleRepository.list()).map(toRuleDto);
}

async function upsertRule(payload = {}, auth = {}) {
  if (!hasGlobal(auth, 'WORK_SCORES:ADJUST')) forbidden();
  return toRuleDto(await ruleRepository.upsert({
    sourceType: payload.sourceType,
    taskType: cleanRuleKey(payload.taskType),
    priority: cleanRuleKey(payload.priority),
    scaleDifficultyLevel: cleanRuleKey(payload.scaleDifficultyLevel),
    points: Number(payload.points),
    status: payload.status,
  }));
}

function validateAdjustment(payload = {}) {
  const expectedVersion = Number(payload.expectedVersion);
  const reason = String(payload.reason || '').trim();
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) fail('expectedVersion must be a non-negative integer');
  if (reason.length < 2 || reason.length > 500) fail('reason must be between 2 and 500 characters');
  return { expectedVersion, reason };
}

function adjustment(current, changes, actorId, reason, type) {
  return {
    type,
    oldPoints: current.finalPoints,
    newPoints: changes.finalPoints,
    oldScoreLevel: current.scoreLevel,
    newScoreLevel: changes.scoreLevel,
    oldStatus: current.status,
    newStatus: changes.status,
    actorId: actorId || null,
    reason,
    adjustedAt: new Date(),
  };
}

function conflict(message) {
  return fail(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
}

function forbidden() {
  return fail('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobal(auth = {}, permission) {
  return auth.system === true
    || authPublic.isSuperAdmin(auth)
    || (auth.permissions || []).includes(permission);
}

function scopedShopIds(auth = {}, permission) {
  return [...new Set((auth.scopes || [])
    .filter((scope) => String(scope.scopeType).toLowerCase() === 'shop')
    .filter((scope) => (scope.permissions || []).includes(permission))
    .map((scope) => String(scope.scopeId)))];
}

function hasTeamScope(auth = {}, permission) {
  return (auth.scopes || []).some((scope) => (
    String(scope.scopeType).toLowerCase() === 'team'
    && (scope.permissions || []).includes(permission)
  ));
}

async function buildReadQuery(query = {}, auth = {}) {
  if (hasGlobal(auth, 'WORK_SCORES:READ') || hasGlobal(auth, 'WORK_SCORES:ADJUST')) return { ...query };
  if (hasTeamScope(auth, 'WORK_SCORES:READ')) {
    const workerIds = await authPublic.listTeamScopedAccountIds(auth, 'WORK_SCORES:READ');
    if (query.workerId && !workerIds.includes(String(query.workerId))) forbidden();
    return { ...query, ...(query.workerId ? {} : { workerIds }) };
  }
  const managerShopIds = [...new Set([
    ...scopedShopIds(auth, 'WORK_SCORES:READ'),
    ...scopedShopIds(auth, 'WORK_SCORES:ADJUST'),
  ])];
  const selfRead = hasGlobal(auth, 'DESIGN:WORK')
    || hasTeamScope(auth, 'DESIGN:WORK')
    || scopedShopIds(auth, 'DESIGN:WORK').length > 0;
  const shopIds = managerShopIds.length
    ? managerShopIds
    : (hasGlobal(auth, 'DESIGN:WORK') || hasTeamScope(auth, 'DESIGN:WORK') ? null : scopedShopIds(auth, 'DESIGN:WORK'));
  if (!managerShopIds.length && !selfRead) forbidden();
  if (query.shopId && shopIds && !shopIds.includes(String(query.shopId))) forbidden();
  return {
    ...query,
    ...(shopIds && !query.shopId ? { shopIds } : {}),
    ...(!managerShopIds.length ? { workerId: auth.accountId } : {}),
  };
}

function assertRowAccess(score, auth, permission, allowSelf = false) {
  if (hasGlobal(auth, permission)) return;
  if (authPublic.canAccessScope(auth, permission, { scopeType: 'shop', scopeId: score.shopId })) return;
  if (allowSelf && String(score.workerId) === String(auth.accountId)
    && authPublic.canAccessScope(auth, 'DESIGN:WORK', { scopeType: 'shop', scopeId: score.shopId })) return;
  forbidden();
}

async function listScores(query = {}, auth = {}) {
  return repository.list(await buildReadQuery(query, auth));
}

function findSourceScore(key) {
  return repository.findBySourceKey(key);
}

async function summarizeScores(query = {}, auth = {}) {
  return repository.summarize(await buildReadQuery(query, auth));
}

async function getScore(scoreId, auth = {}) {
  const score = await repository.findById(scoreId);
  if (!score) fail('Work score not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  if (hasTeamScope(auth, 'WORK_SCORES:READ')) {
    const workerIds = await authPublic.listTeamScopedAccountIds(auth, 'WORK_SCORES:READ');
    if (workerIds.includes(String(score.workerId))) return score;
  }
  assertRowAccess(score, auth, 'WORK_SCORES:READ', true);
  return score;
}

async function overrideScore(scoreId, payload = {}, auth = {}) {
  const { expectedVersion, reason } = validateAdjustment(payload);
  const points = Number(payload.points);
  if (!Number.isFinite(points) || points < 0) fail('points must be a finite non-negative number');
  const current = await repository.findById(scoreId);
  if (!current) fail('Work score not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  assertRowAccess(current, auth, 'WORK_SCORES:ADJUST');
  if (current.status !== workScoreStatuses.ACTIVE) conflict('A voided score cannot be overridden');
  const changes = {
    finalPoints: points,
    scoreLevel: payload.scoreLevel || current.scoreLevel,
    status: current.status,
  };
  const saved = await repository.adjust(scoreId, expectedVersion, {
    finalPoints: changes.finalPoints,
    scoreLevel: changes.scoreLevel,
    adjustments: [...(current.adjustments || []), adjustment(current, changes, auth.accountId, reason, workScoreAdjustmentTypes.OVERRIDE)],
  });
  if (!saved) conflict('Work score was modified by another request');
  return saved;
}

async function voidScore(scoreId, payload = {}, auth = {}, adjustmentType = workScoreAdjustmentTypes.VOID) {
  const { expectedVersion, reason } = validateAdjustment(payload);
  const current = await repository.findById(scoreId);
  if (!current) fail('Work score not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  assertRowAccess(current, auth, 'WORK_SCORES:ADJUST');
  if (current.status !== workScoreStatuses.ACTIVE) conflict('Work score is already voided');
  const changes = { finalPoints: current.finalPoints, scoreLevel: current.scoreLevel, status: workScoreStatuses.VOIDED };
  const saved = await repository.adjust(scoreId, expectedVersion, {
    status: changes.status,
    adjustments: [...(current.adjustments || []), adjustment(current, changes, auth.accountId, reason, adjustmentType)],
  });
  if (!saved) conflict('Work score was modified by another request');
  return saved;
}

function voidObsoleteSourceScore(scoreId, expectedVersion, reason = 'Source output was replaced') {
  return voidScore(scoreId, { expectedVersion, reason }, { system: true }, workScoreAdjustmentTypes.SYSTEM_VOID);
}

module.exports = {
  designPoints,
  findSourceScore,
  getScore,
  listScores,
  listRules,
  overrideScore,
  recordDesignSubmissionScore,
  recordProductionScaleScores,
  summarizeScores,
  upsertRule,
  voidObsoleteSourceScore,
  voidScore,
};
