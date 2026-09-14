const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const auditPublic = require('../../audit/public');
const { toAdjustmentDto } = require('../dtos/payroll.dto');
const profileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/payroll.repository');
const payrollConfigService = require('./payrollConfig.service');
const payrollService = require('./payroll.service');

function appError(message, statusCode, code) {
  return new AppError(message, statusCode, true, code);
}

function conflict(message) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
}

function badRequest(message) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
}

async function assertConfiguredAdjustment(payload) {
  const settings = await payrollConfigService.getPayrollSettings();
  if (payload.type && !settings.adjustmentTypes.includes(payload.type)) {
    throw badRequest(`Unsupported payroll adjustment type: ${payload.type}`);
  }
  if (payload.code && !settings.adjustmentCodes.includes(payload.code)) {
    throw badRequest(`Unsupported payroll adjustment code: ${payload.code}`);
  }
}

async function runTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function openRun(month, year, session) {
  const run = await repository.findRunByPeriod(month, year, { session });
  if (run && run.status !== 'DRAFT') throw conflict('Payroll period is finalized');
  return run;
}

async function refreshDraft(adjustment, run, session) {
  if (!run) return { requiresReview: false, draftPayrollRefreshed: false };
  const refreshed = await payrollService.refreshDraftPayrollResult(
    String(adjustment.profileId), adjustment.month, adjustment.year, { session },
  );
  if (!refreshed) throw conflict('Draft payroll result cannot be refreshed');
  return { requiresReview: false, draftPayrollRefreshed: true };
}

async function listAdjustments(query = {}, authContext = {}) {
  const result = await repository.listAdjustments(query);
  const response = { items: result.items.map((item) => toAdjustmentDto(item)), pagination: result.pagination };
  return response;
}

async function createAdjustment(payload, actor = {}) {
  await assertConfiguredAdjustment(payload);
  const profile = await profileRepository.findById(payload.profileId);
  if (!profile || profile.isDeleted) {
    throw appError('Employee profile not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  }
  return runTransaction(async (session) => {
    const run = await openRun(payload.month, payload.year, session);
    const adjustment = await repository.createAdjustment({
      ...payload,
      status: 'APPROVED',
      createdByAccountId: actor.accountId,
      updatedByAccountId: actor.accountId,
    }, { session });
    await auditPublic.record({
      actorType: 'ACCOUNT', actorAccountId: actor.accountId, action: 'CREATED',
      entityType: 'HR_PAYROLL_ADJUSTMENT', entityId: String(adjustment._id),
      outcome: 'SUCCEEDED', source: 'HTTP',
      metadata: { profileId: String(adjustment.profileId), month: adjustment.month, year: adjustment.year },
      deduplicationKey: `payroll-adjustment:${adjustment._id}:CREATED`,
    }, { session });
    return toAdjustmentDto(adjustment, await refreshDraft(adjustment, run, session));
  });
}

async function createBulkAdjustment(payload, actor = {}) {
  await assertConfiguredAdjustment(payload);
  const uniqueProfileIds = [...new Set((payload.profileIds || []).map(String))];
  if (!uniqueProfileIds.length) throw badRequest('No profile selected');
  const profiles = await profileRepository.listByIds(uniqueProfileIds);
  if (profiles.length !== uniqueProfileIds.length) {
    throw appError('Some employee profiles were not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  }
  const basePayload = {
    month: payload.month,
    year: payload.year,
    type: payload.type,
    code: payload.code,
    name: payload.name,
    amount: payload.amount,
    note: payload.note,
    status: 'APPROVED',
    createdByAccountId: actor.accountId,
    updatedByAccountId: actor.accountId,
  };
  return runTransaction(async (session) => {
    const run = await openRun(payload.month, payload.year, session);
    const adjustments = await repository.createAdjustments(
      uniqueProfileIds.map((profileId) => ({ ...basePayload, profileId })),
      { session },
    );
    const mapped = [];
    for (const adjustment of adjustments) {
      mapped.push(toAdjustmentDto(adjustment, await refreshDraft(adjustment, run, session)));
    }
    await auditPublic.record({
      actorType: 'ACCOUNT', actorAccountId: actor.accountId, action: 'CREATED_BULK',
      entityType: 'HR_PAYROLL_ADJUSTMENT', entityId: `bulk:${payload.month}-${payload.year}:${adjustments.length}`,
      outcome: 'SUCCEEDED', source: 'HTTP',
      metadata: {
        profileIds: uniqueProfileIds,
        month: payload.month,
        year: payload.year,
        count: adjustments.length,
      },
      deduplicationKey: `payroll-adjustment-bulk:${payload.month}-${payload.year}:${uniqueProfileIds.join(',')}:CREATED`,
    }, { session });
    return mapped;
  });
}

async function updateAdjustment(id, payload, actor = {}) {
  await assertConfiguredAdjustment(payload);
  return runTransaction(async (session) => {
    const current = await repository.findAdjustmentById(id, { session });
    if (!current) throw appError('Payroll adjustment is stale or cancelled', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
    const run = await openRun(current.month, current.year, session);
    const adjustment = await repository.updateAdjustment(id, payload.expectedVersion, {
      ...Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'expectedVersion')),
      updatedByAccountId: actor.accountId,
    }, { session });
    if (!adjustment) throw conflict('Payroll adjustment is stale or cancelled');
    await auditPublic.record({
      actorType: 'ACCOUNT', actorAccountId: actor.accountId, action: 'UPDATED',
      entityType: 'HR_PAYROLL_ADJUSTMENT', entityId: id, outcome: 'SUCCEEDED', source: 'HTTP',
      metadata: { version: adjustment.version },
      deduplicationKey: `payroll-adjustment:${id}:UPDATED:${adjustment.version}`,
    }, { session });
    return toAdjustmentDto(adjustment, await refreshDraft(adjustment, run, session));
  });
}

async function cancelAdjustment(id, expectedVersion, actor = {}) {
  return runTransaction(async (session) => {
    const current = await repository.findAdjustmentById(id, { session });
    if (!current) throw appError('Payroll adjustment not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
    const run = await openRun(current.month, current.year, session);
    if (current.status === 'CANCELLED') {
      return toAdjustmentDto(current, await refreshDraft(current, run, session));
    }
    const adjustment = await repository.cancelAdjustment(id, expectedVersion, actor.accountId, { session });
    if (!adjustment) throw conflict('Payroll adjustment is stale');
    await auditPublic.record({
      actorType: 'ACCOUNT', actorAccountId: actor.accountId, action: 'CANCELLED',
      entityType: 'HR_PAYROLL_ADJUSTMENT', entityId: id, outcome: 'SUCCEEDED', source: 'HTTP',
      metadata: { version: adjustment.version }, deduplicationKey: `payroll-adjustment:${id}:CANCELLED`,
    }, { session });
    return toAdjustmentDto(adjustment, await refreshDraft(adjustment, run, session));
  });
}

module.exports = {
  cancelAdjustment,
  createAdjustment,
  createBulkAdjustment,
  listAdjustments,
  updateAdjustment,
};
