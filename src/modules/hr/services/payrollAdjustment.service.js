const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const auditPublic = require('../../audit/public');
const { toAdjustmentDto } = require('../dtos/payroll.dto');
const profileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/payroll.repository');

function appError(message, statusCode, code) {
  return new AppError(message, statusCode, true, code);
}

async function reviewState(adjustment) {
  return Boolean(await repository.findFinalizedResultForPeriod(
    adjustment.profileId, adjustment.month, adjustment.year,
  ));
}

async function listAdjustments(query = {}) {
  const result = await repository.listAdjustments(query);
  return { items: result.items.map((item) => toAdjustmentDto(item)), pagination: result.pagination };
}

async function createAdjustment(payload, actor = {}) {
  const profile = await profileRepository.findById(payload.profileId);
  if (!profile || profile.isDeleted) {
    throw appError('Employee profile not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  }
  const adjustment = await repository.createAdjustment({
    ...payload,
    status: 'APPROVED',
    createdByAccountId: actor.accountId,
    updatedByAccountId: actor.accountId,
  });
  await auditPublic.record({
    actorAccountId: actor.accountId,
    action: 'CREATED',
    entityType: 'HR_PAYROLL_ADJUSTMENT',
    entityId: String(adjustment._id),
    metadata: { profileId: String(adjustment.profileId), month: adjustment.month, year: adjustment.year },
    deduplicationKey: `payroll-adjustment:${adjustment._id}:CREATED`,
  });
  return toAdjustmentDto(adjustment, { requiresReview: await reviewState(adjustment) });
}

async function updateAdjustment(id, payload, actor = {}) {
  const adjustment = await repository.updateAdjustment(id, payload.expectedVersion, {
    ...Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'expectedVersion')),
    updatedByAccountId: actor.accountId,
  });
  if (!adjustment) throw appError('Payroll adjustment is stale or cancelled', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  await auditPublic.record({
    actorAccountId: actor.accountId,
    action: 'UPDATED',
    entityType: 'HR_PAYROLL_ADJUSTMENT',
    entityId: id,
    metadata: { version: adjustment.version },
    deduplicationKey: `payroll-adjustment:${id}:UPDATED:${adjustment.version}`,
  });
  return toAdjustmentDto(adjustment, { requiresReview: await reviewState(adjustment) });
}

async function cancelAdjustment(id, expectedVersion, actor = {}) {
  let adjustment = await repository.cancelAdjustment(id, expectedVersion, actor.accountId);
  if (!adjustment) {
    const current = await repository.findAdjustmentById(id);
    if (!current) throw appError('Payroll adjustment not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
    if (current.status === 'CANCELLED') return toAdjustmentDto(current, { requiresReview: await reviewState(current) });
    throw appError('Payroll adjustment is stale', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  }
  await auditPublic.record({
    actorAccountId: actor.accountId,
    action: 'CANCELLED',
    entityType: 'HR_PAYROLL_ADJUSTMENT',
    entityId: id,
    metadata: { version: adjustment.version },
    deduplicationKey: `payroll-adjustment:${id}:CANCELLED`,
  });
  return toAdjustmentDto(adjustment, { requiresReview: await reviewState(adjustment) });
}

module.exports = { cancelAdjustment, createAdjustment, listAdjustments, updateAdjustment };
