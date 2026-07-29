const { randomUUID } = require('crypto');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const auditPublic = require('../../audit/public');
const { toAdjustmentDto } = require('../dtos/payroll.dto');
const profileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/payroll.repository');
const payrollService = require('./payroll.service');

function appError(message, statusCode, code) {
  return new AppError(message, statusCode, true, code);
}

async function reviewState(adjustment) {
  return Boolean(await repository.findFinalizedResultForPeriod(
    adjustment.profileId, adjustment.month, adjustment.year,
  ));
}

async function mutationState(adjustment) {
  const requiresReview = await reviewState(adjustment);
  const refreshed = requiresReview ? null : await payrollService.refreshDraftPayrollResult(
    String(adjustment.profileId), adjustment.month, adjustment.year,
  );
  return { requiresReview, draftPayrollRefreshed: Boolean(refreshed) };
}

async function listAdjustments(query = {}, authContext = {}) {
  const result = await repository.listAdjustments(query);
  const response = { items: result.items.map((item) => toAdjustmentDto(item)), pagination: result.pagination };
  const auditContext = authContext.auditContext || {};
  const safeFilters = Object.fromEntries([
    'profileId', 'month', 'year', 'status', 'type', 'page', 'limit',
  ].filter((key) => query[key] !== undefined).map((key) => [key, query[key]]));
  await auditPublic.record({
    actorType: authContext.accountId ? 'ACCOUNT' : 'SYSTEM',
    actorAccountId: authContext.accountId || null,
    actorSnapshot: {},
    action: 'HR_PAYROLL_ADJUSTMENTS_READ',
    entityType: 'HR_PAYROLL_ADJUSTMENT',
    entityId: query.profileId || 'payroll-adjustments',
    outcome: 'SUCCEEDED',
    source: 'HTTP',
    requestId: auditContext.requestId || null,
    ipAddress: auditContext.ipAddress || null,
    userAgent: auditContext.userAgent || null,
    changes: null,
    metadata: { ...safeFilters, rowCount: response.items.length },
    deduplicationKey: `payroll-read:hr_payroll_adjustments_read:${randomUUID()}`,
  }, {});
  return response;
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
    actorType: 'ACCOUNT',
    actorAccountId: actor.accountId,
    action: 'CREATED',
    entityType: 'HR_PAYROLL_ADJUSTMENT',
    entityId: String(adjustment._id),
    outcome: 'SUCCEEDED',
    source: 'HTTP',
    metadata: { profileId: String(adjustment.profileId), month: adjustment.month, year: adjustment.year },
    deduplicationKey: `payroll-adjustment:${adjustment._id}:CREATED`,
  });
  return toAdjustmentDto(adjustment, await mutationState(adjustment));
}

async function updateAdjustment(id, payload, actor = {}) {
  const adjustment = await repository.updateAdjustment(id, payload.expectedVersion, {
    ...Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'expectedVersion')),
    updatedByAccountId: actor.accountId,
  });
  if (!adjustment) throw appError('Payroll adjustment is stale or cancelled', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  await auditPublic.record({
    actorType: 'ACCOUNT',
    actorAccountId: actor.accountId,
    action: 'UPDATED',
    entityType: 'HR_PAYROLL_ADJUSTMENT',
    entityId: id,
    outcome: 'SUCCEEDED',
    source: 'HTTP',
    metadata: { version: adjustment.version },
    deduplicationKey: `payroll-adjustment:${id}:UPDATED:${adjustment.version}`,
  });
  return toAdjustmentDto(adjustment, await mutationState(adjustment));
}

async function cancelAdjustment(id, expectedVersion, actor = {}) {
  let adjustment = await repository.cancelAdjustment(id, expectedVersion, actor.accountId);
  if (!adjustment) {
    const current = await repository.findAdjustmentById(id);
    if (!current) throw appError('Payroll adjustment not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
    if (current.status === 'CANCELLED') return toAdjustmentDto(current, await mutationState(current));
    throw appError('Payroll adjustment is stale', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  }
  await auditPublic.record({
    actorType: 'ACCOUNT',
    actorAccountId: actor.accountId,
    action: 'CANCELLED',
    entityType: 'HR_PAYROLL_ADJUSTMENT',
    entityId: id,
    outcome: 'SUCCEEDED',
    source: 'HTTP',
    metadata: { version: adjustment.version },
    deduplicationKey: `payroll-adjustment:${id}:CANCELLED`,
  });
  return toAdjustmentDto(adjustment, await mutationState(adjustment));
}

module.exports = { cancelAdjustment, createAdjustment, listAdjustments, updateAdjustment };
