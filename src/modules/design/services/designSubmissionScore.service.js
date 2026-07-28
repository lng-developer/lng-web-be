const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const hrPublic = require('../../hr/public');
const organizationPublic = require('../../organization/public');
const {
  designPermissions,
  designScoreLevels,
  designScoreStatuses,
  designTaskPriorities,
  designTaskSubmissionStatuses,
  designTaskTypes,
} = require('../constants/design.constants');
const repository = require('../repositories/designSubmissionScore.repository');
const taskRepository = require('../repositories/designTask.repository');
const { toScoreDto, toScoreSummaryDto } = require('../dtos/designSubmissionScore.dto');

const DEFAULT_POINTS_BY_TASK_TYPE = Object.freeze({
  [designTaskTypes.PSD_TEMPLATE]: 3,
  [designTaskTypes.PNG_ASSET]: 1,
  [designTaskTypes.MOCKUP]: 1,
  [designTaskTypes.IDEA]: 2,
  [designTaskTypes.CLONE]: 1,
});

const PRIORITY_MULTIPLIER = Object.freeze({
  [designTaskPriorities.LOW]: 1,
  [designTaskPriorities.NORMAL]: 1,
  [designTaskPriorities.HIGH]: 1.25,
  [designTaskPriorities.URGENT]: 1.5,
});

function toId(value) {
  if (value === undefined || value === null) return null;
  if (value._id !== undefined && value._id !== null) return String(value._id);
  if (typeof value.id === 'string') return value.id;
  return String(value);
}

function validationError(message) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
}

function scoreNotFound() {
  return new AppError('Submission score not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalReviewPermission(authContext = {}) {
  const permissions = authContext.permissions || [];
  return permissions.includes(designPermissions.REVIEW) || permissions.includes(designPermissions.WRITE);
}

function assertCanReviewTask(task, authContext = {}) {
  if (authContext.system === true || hasGlobalReviewPermission(authContext)) return;
  const shopScope = { scopeType: 'shop', scopeId: task.shopId };
  if (
    authPublic.canAccessScope(authContext, designPermissions.REVIEW, shopScope)
    || authPublic.canAccessScope(authContext, designPermissions.WRITE, shopScope)
  ) return;
  throw forbidden();
}

async function loadReviewableTask(taskId, authContext = {}) {
  const task = await taskRepository.findById(taskId);
  if (!task) throw scoreNotFound();
  assertCanReviewTask(task, authContext);
}

function computeDefaultScore(task = {}) {
  const taskType = task.taskType || designTaskTypes.PSD_TEMPLATE;
  const basePoints = DEFAULT_POINTS_BY_TASK_TYPE[taskType] || 1;
  const priority = task.priority || designTaskPriorities.NORMAL;
  const multiplier = PRIORITY_MULTIPLIER[priority] || 1;

  return {
    basePoints,
    finalPoints: Math.round(basePoints * multiplier * 100) / 100,
    scoreLevel: multiplier > 1 ? designScoreLevels.HARD : designScoreLevels.STANDARD,
    ruleSnapshot: { taskType, priority, basePoints, multiplier },
  };
}

async function snapshotDesigner(designerId) {
  const [profiles, organizations] = await Promise.all([
    hrPublic.listEmployeeProfilesByAccountIds([designerId]),
    organizationPublic.listAccountOrganizationSummaries([designerId]),
  ]);
  const profile = profiles?.[0] || {};
  const organization = organizations?.[0] || {};

  return {
    designerName: profile.fullName || null,
    teamId: organization.team?.id || null,
    teamName: organization.team?.name || null,
    departmentId: organization.department?.id || null,
    departmentName: organization.department?.name || null,
  };
}

async function scoreApprovedSubmission(task = {}, submission = {}, authContext = {}) {
  const taskId = toId(task._id || task.id);
  const submissionId = toId(submission._id || submission.id);
  const assetId = toId(submission.approvedAssetId);
  const designerId = toId(submission.submittedBy);

  if (
    submission.status !== designTaskSubmissionStatuses.APPROVED
    || !taskId
    || !submissionId
    || !assetId
    || !designerId
  ) {
    return null;
  }

  const score = computeDefaultScore(task);
  const designer = await snapshotDesigner(designerId);
  const saved = await repository.upsertAutoScore({
    taskId,
    submissionId,
    assetId,
    taskType: task.taskType,
    submissionVersion: submission.version || 1,
    designerId,
    ...designer,
    ...score,
    status: designScoreStatuses.ACTIVE,
    scoredBy: authContext.accountId || null,
    scoredAt: new Date(),
  });

  return toScoreDto(saved);
}

async function overrideSubmissionScore(scoreId, payload = {}, authContext = {}) {
  const rawPoints = payload.points;
  const points = Number(rawPoints);
  const reason = String(payload.overrideReason || '').trim();

  if (
    rawPoints === null
    || rawPoints === undefined
    || (typeof rawPoints === 'string' && !rawPoints.trim())
    || !Number.isFinite(points)
    || points < 0
  ) {
    throw validationError('points must be a non-negative number');
  }
  if (!reason) throw validationError('overrideReason is required');

  const score = await repository.findActiveById(scoreId);
  if (!score) throw scoreNotFound();
  await loadReviewableTask(score.taskId, authContext);

  const patch = {
    finalPoints: points,
    override: {
      points,
      reason,
      overriddenBy: authContext.accountId || null,
      overriddenAt: new Date(),
    },
  };
  if (payload.scoreLevel) patch.scoreLevel = payload.scoreLevel;

  const saved = await repository.overrideScore(scoreId, patch);
  if (!saved) throw scoreNotFound();

  return toScoreDto(saved);
}

async function voidSubmissionScore(taskId, submissionId, assetId, payload = {}, authContext = {}) {
  const reason = String(payload.voidReason || '').trim();
  if (!reason) throw validationError('voidReason is required');

  const score = await repository.findActiveByTaskSubmissionAsset(taskId, submissionId, assetId);
  if (!score) throw scoreNotFound();
  await loadReviewableTask(score.taskId, authContext);

  const saved = await repository.voidByTaskSubmissionAsset(taskId, submissionId, assetId, {
    voidedBy: authContext.accountId || null,
    voidedAt: new Date(),
    voidReason: reason,
  });
  if (!saved) throw scoreNotFound();

  return toScoreDto(saved);
}

async function summarizeScores(query = {}) {
  return toScoreSummaryDto(await repository.summarize(query));
}

module.exports = {
  computeDefaultScore,
  overrideSubmissionScore,
  scoreApprovedSubmission,
  summarizeScores,
  voidSubmissionScore,
};
