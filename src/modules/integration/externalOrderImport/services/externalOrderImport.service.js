const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');
const { normalizePagination } = require('../../../../shared/utils/pagination');
const jobRepository = require('../repositories/externalOrderImportJob.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const manualExcelImportService = require('../sources/manualExcel/manualExcelImport.service');
const postImportMappingQueue = require('./postImportMappingQueue.service');
const authPublic = require('../../../auth/public');
const orderPublic = require('../../../order/public');
const mappingPublic = require('../../../mapping/public');
const productionPublic = require('../../../production/public');
const {
  externalOrderImportIssueStatuses,
} = require('../constants/externalOrderImportIssueTypes');
const {
  externalOrderImportJobStatuses,
  externalOrderPostImportStatuses,
  externalOrderRawRecordImportStatuses,
  externalOrderRawRecordNormalizeStatuses,
} = require('../constants/externalOrderImportStatuses');

const POST_IMPORT_STALE_MS = 10 * 60 * 1000;
const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function canAccessShop(shopId, permission, authContext = {}) {
  if (authContext.system === true) return true;

  const scope = { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId };
  if (authPublic.canAccessScope(authContext, permission, scope)) return true;

  return permission === ORDER_READ_PERMISSION
    && authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, scope);
}

function assertShopAccess(shopId, permission, authContext = {}) {
  if (!shopId || !canAccessShop(shopId, permission, authContext)) throw forbidden();
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(toId))];
}

async function importFromManualExcel(payload, authContext) {
  assertShopAccess(payload.shopId, ORDER_WRITE_PERMISSION, authContext);
  return manualExcelImportService.importManualExcelOrderReport(payload);
}

async function importFromEtsySoldOrderItems(payload, authContext) {
  assertShopAccess(payload.shopId, ORDER_WRITE_PERMISSION, authContext);
  return manualExcelImportService.importEtsySoldOrderItems(payload);
}

async function loadImportJob(jobId) {
  const job = await jobRepository.findById(jobId);

  if (!job) {
    throw notFound('Import job not found');
  }

  return job;
}

async function loadAuthorizedImportJob(jobId, permission, authContext) {
  const job = await loadImportJob(jobId);
  assertShopAccess(job.shopId, permission, authContext);
  return job;
}

async function getImportJob(jobId, authContext) {
  const job = await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);

  return {
    ...job,
    summary: await buildImportJobSummary(jobId),
  };
}

async function buildImportJobSummary(jobId) {
  const rawRecords = await rawRecordRepository.listAllByJob(jobId);
  const orderItemIds = unique(rawRecords.map((rawRecord) => rawRecord.orderItemId));
  const [orderItems, plans, productionTasks] = await Promise.all([
    Promise.all(orderItemIds.map((orderItemId) => orderPublic.findItemById(orderItemId))).then((items) => items.filter(Boolean)),
    mappingPublic.listFulfillmentPlansByOrderItemIds(orderItemIds, { system: true, source: 'EXTERNAL_ORDER_IMPORT_SUMMARY' }),
    productionPublic.listTaskSummariesByOrderItemIds(orderItemIds, { system: true, source: 'EXTERNAL_ORDER_IMPORT_SUMMARY' }),
  ]);

  return {
    rawRecords: {
      total: rawRecords.length,
      normalized: rawRecords.filter((record) => record.normalizeStatus === externalOrderRawRecordNormalizeStatuses.NORMALIZED).length,
      normalizeFailed: rawRecords.filter((record) => record.normalizeStatus === externalOrderRawRecordNormalizeStatuses.FAILED).length,
      imported: rawRecords.filter((record) => record.importStatus === externalOrderRawRecordImportStatuses.IMPORTED).length,
      importFailed: rawRecords.filter((record) => record.importStatus === externalOrderRawRecordImportStatuses.FAILED).length,
      skipped: rawRecords.filter((record) => record.importStatus === externalOrderRawRecordImportStatuses.SKIPPED).length,
    },
    postImport: {
      pending: rawRecords.filter((record) => record.postImportStatus === externalOrderPostImportStatuses.PENDING).length,
      queued: rawRecords.filter((record) => record.postImportStatus === externalOrderPostImportStatuses.QUEUED).length,
      processing: rawRecords.filter((record) => record.postImportStatus === externalOrderPostImportStatuses.PROCESSING).length,
      completed: rawRecords.filter((record) => record.postImportStatus === externalOrderPostImportStatuses.COMPLETED).length,
      failed: rawRecords.filter((record) => record.postImportStatus === externalOrderPostImportStatuses.FAILED).length,
      skipped: rawRecords.filter((record) => record.postImportStatus === externalOrderPostImportStatuses.SKIPPED).length,
    },
    orderItems: {
      total: orderItems.length,
      linkedListing: orderItems.filter((item) => item.listingId).length,
      fulfillmentReady: orderItems.filter((item) => item.status === 'FULFILLMENT_READY').length,
      needProduction: orderItems.filter((item) => item.status === 'NEED_PRODUCTION').length,
      blocked: orderItems.filter((item) => item.status === 'BLOCKED').length,
    },
    plans: {
      ready: plans.filter((plan) => plan.status === 'READY').length,
      blocked: plans.filter((plan) => plan.status === 'BLOCKED').length,
    },
    productionTasks: {
      total: productionTasks.length,
      blocked: productionTasks.filter((task) => task.productionStatus === 'BLOCKED').length,
      needScale: productionTasks.filter((task) => task.scaleStatus === 'NEED_SCALE').length,
      readyToSendVendor: productionTasks.filter((task) => task.productionStatus === 'READY_TO_SEND_VENDOR').length,
      sentToVendor: productionTasks.filter((task) => task.productionStatus === 'SENT_TO_VENDOR').length,
    },
  };
}

async function listImportJobIssues(jobId, params, authContext) {
  await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  return issueRepository.listByJob(jobId, params);
}

function hasGlobalOrderRead(authContext = {}) {
  const permissions = authContext.permissions || [];
  return authContext.system === true
    || authPublic.isSuperAdmin(authContext)
    || permissions.includes(ORDER_READ_PERMISSION)
    || permissions.includes(ORDER_WRITE_PERMISSION);
}

function getReadableShopIds(authContext = {}) {
  if (hasGlobalOrderRead(authContext)) return null;

  return [...new Set((authContext.scopes || [])
    .filter((scope) => scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).some((permission) => (
        permission === ORDER_READ_PERMISSION || permission === ORDER_WRITE_PERMISSION
      )))
    .map((scope) => String(scope.scopeId)))];
}

function emptyPage(params = {}) {
  const { page, limit } = normalizePagination(params);
  return { items: [], total: 0, page, limit };
}

async function listIssues(params = {}, authContext = {}) {
  const shopIds = getReadableShopIds(authContext);
  if (shopIds === null) return issueRepository.list(params);
  if (shopIds.length === 0) return emptyPage(params);

  const importJobIds = (await jobRepository.findIds({ shopIds })).map(String);
  if (importJobIds.length === 0) return emptyPage(params);

  if (params.importJobId && !importJobIds.includes(String(params.importJobId))) {
    return emptyPage(params);
  }

  return issueRepository.list(params.importJobId
    ? params
    : { ...params, importJobIds });
}

async function listOpenIssuesForExternalItem({ externalOrderId, externalItemId } = {}) {
  const result = await issueRepository.list({
    externalOrderId,
    externalItemId,
    status: externalOrderImportIssueStatuses.OPEN,
    page: 1,
    limit: 100,
  });

  return result.items || [];
}

async function listImportJobRawRecords(jobId, params, authContext) {
  await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  return rawRecordRepository.listByJob(jobId, params);
}

async function retryImportJob(jobId, authContext) {
  const job = await loadAuthorizedImportJob(jobId, ORDER_WRITE_PERMISSION, authContext);
  const replayResult = typeof manualExcelImportService.retryManualImportJob === 'function'
    ? await manualExcelImportService.retryManualImportJob(job)
    : { replayedRawRecords: 0 };
  const rawRecords = await rawRecordRepository.listAllByJob(jobId);
  let requeuedPostImportJobs = 0;
  let skippedCompletedRecords = 0;

  for (const rawRecord of rawRecords) {
    if (rawRecord.importStatus !== externalOrderRawRecordImportStatuses.IMPORTED) {
      continue;
    }
    if (rawRecord.postImportStatus === externalOrderPostImportStatuses.COMPLETED) {
      skippedCompletedRecords += 1;
      continue;
    }
    const staleThreshold = Date.now() - POST_IMPORT_STALE_MS;
    const queuedStale = rawRecord.postImportStatus === externalOrderPostImportStatuses.QUEUED
      && rawRecord.postImportQueuedAt
      && new Date(rawRecord.postImportQueuedAt).getTime() <= staleThreshold;
    const processingStale = rawRecord.postImportStatus === externalOrderPostImportStatuses.PROCESSING
      && rawRecord.postImportLeaseExpiresAt
      && new Date(rawRecord.postImportLeaseExpiresAt).getTime() <= Date.now();
    const canRetryPostImport = [
      externalOrderPostImportStatuses.PENDING,
      externalOrderPostImportStatuses.FAILED,
    ].includes(rawRecord.postImportStatus) || queuedStale || processingStale;
    if (!canRetryPostImport) {
      continue;
    }
    if (!rawRecord.orderItemId) {
      continue;
    }
    const result = await postImportMappingQueue.enqueuePostImportMappingJob({
      importJobId: jobId,
      rawRecordId: rawRecord._id,
      orderId: rawRecord.orderId,
      orderItemId: rawRecord.orderItemId,
      externalOrderId: rawRecord.externalOrderId,
      externalItemId: rawRecord.externalItemId,
      source: 'EXTERNAL_ORDER_IMPORT',
    });
    if (result.queued) requeuedPostImportJobs += 1;
  }

  return {
    jobId,
    replayedRawRecords: replayResult.replayedRawRecords || 0,
    requeuedPostImportJobs,
    skippedCompletedRecords,
  };
}

function summarizeRawRecordCounters(rawRecords = []) {
  return {
    totalRecords: rawRecords.length,
    parsedCount: rawRecords.filter((record) => (
      record.normalizeStatus === externalOrderRawRecordNormalizeStatuses.NORMALIZED
    )).length,
    importedCount: rawRecords.filter((record) => (
      record.importStatus === externalOrderRawRecordImportStatuses.IMPORTED
    )).length,
    skippedCount: rawRecords.filter((record) => (
      record.importStatus === externalOrderRawRecordImportStatuses.SKIPPED
    )).length,
    failedCount: rawRecords.filter((record) => (
      record.importStatus === externalOrderRawRecordImportStatuses.FAILED
    )).length,
  };
}

async function recoverStaleImportJobs({ staleMinutes = 30, limit = 50 } = {}) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const jobs = await jobRepository.listStaleActive({ cutoff, limit });
  const results = [];

  for (const job of jobs) {
    const jobId = toId(job);
    const retryResult = await retryImportJob(jobId, {
      system: true,
      source: 'EXTERNAL_ORDER_IMPORT_RECOVERY',
    });
    const rawRecords = await rawRecordRepository.listAllByJob(jobId);
    const hasPendingImport = rawRecords.some((record) => (
      [
        externalOrderRawRecordImportStatuses.PENDING,
        externalOrderRawRecordImportStatuses.FAILED,
      ].includes(record.importStatus)
    ));

    if (hasPendingImport) {
      results.push({ jobId, status: job.status, retryResult });
      continue;
    }

    const counters = summarizeRawRecordCounters(rawRecords);
    const hasFailure = counters.failedCount > 0 || rawRecords.some((record) => (
      record.postImportStatus === externalOrderPostImportStatuses.FAILED
    ));
    const status = hasFailure
      ? externalOrderImportJobStatuses.PARTIAL_FAILED
      : externalOrderImportJobStatuses.COMPLETED;
    await jobRepository.updateCounters(jobId, { ...counters, finishedAt: new Date() });
    await jobRepository.updateStatus(jobId, status, { finishedAt: new Date() });
    results.push({ jobId, status, retryResult });
  }

  return { recoveredCount: results.length, items: results };
}

module.exports = {
  importFromEtsySoldOrderItems,
  importFromManualExcel,
  getImportJob,
  listIssues,
  listImportJobIssues,
  listImportJobRawRecords,
  listOpenIssuesForExternalItem,
  recoverStaleImportJobs,
  retryImportJob,
};
