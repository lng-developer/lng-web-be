const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');
const { normalizePagination } = require('../../../../shared/utils/pagination');
const jobRepository = require('../repositories/externalOrderImportJob.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const manualExcelImportService = require('../sources/manualExcel/manualExcelImport.service');
const postImportMappingQueue = require('./postImportMappingQueue.service');
const externalOrderImportQueue = require('./externalOrderImportQueue.service');
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

function conflict(message) {
  return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
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

function trustedExtensionShopId(authContext = {}) {
  if (authContext.tokenType !== 'EXTENSION') return null;
  return authContext.scopes?.find((scope) => scope.scopeType === SHOP_SCOPE_TYPE)?.scopeId || null;
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(toId))];
}

async function importFromManualExcel(payload, authContext) {
  const shopId = trustedExtensionShopId(authContext) || payload.shopId;
  assertShopAccess(shopId, ORDER_WRITE_PERMISSION, authContext);
  const result = await manualExcelImportService.prepareQueuedManualExcelOrderReport({
    ...payload,
    shopId,
    source: authContext?.tokenType === 'EXTENSION' ? 'AMAZON_EXTENSION_REPORT' : undefined,
  });
  if (result.status === externalOrderImportJobStatuses.PENDING) {
    await externalOrderImportQueue.enqueueImportJob({ jobId: result.jobId });
  }
  return result;
}

async function importFromEtsySoldOrderItems(payload, authContext) {
  assertShopAccess(payload.shopId, ORDER_WRITE_PERMISSION, authContext);
  const result = await manualExcelImportService.prepareQueuedEtsySoldOrderItems(payload);
  if (result.status === externalOrderImportJobStatuses.PENDING) {
    await externalOrderImportQueue.enqueueImportJob({ jobId: result.jobId });
  }
  return result;
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

function percent(done, total) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function isTerminalJobStatus(status) {
  return [
    externalOrderImportJobStatuses.COMPLETED,
    externalOrderImportJobStatuses.PARTIAL_FAILED,
    externalOrderImportJobStatuses.FAILED,
    externalOrderImportJobStatuses.CANCELLED,
  ].includes(status);
}

async function getImportJobProgress(jobId, authContext) {
  const job = await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  const [rawCounts, issueCounts] = await Promise.all([
    rawRecordRepository.countStatusesByJob(jobId),
    issueRepository.countByJobStatus(jobId),
  ]);
  const total = rawCounts.total || job.totalRecords || 0;
  const parsedDone = (rawCounts.normalized || 0) + (rawCounts.normalizeFailed || 0) + (rawCounts.normalizeSkipped || 0);
  const importDone = (rawCounts.imported || 0) + (rawCounts.importFailed || 0) + (rawCounts.importSkipped || 0);
  const mappingDone = (rawCounts.postImportCompleted || 0) + (rawCounts.postImportFailed || 0) + (rawCounts.postImportSkipped || 0);

  return {
    job,
    phases: {
      parse: {
        total,
        pending: rawCounts.normalizePending || 0,
        completed: parsedDone,
        failed: rawCounts.normalizeFailed || 0,
        skipped: rawCounts.normalizeSkipped || 0,
        percentage: percent(parsedDone, total),
      },
      import: {
        total,
        pending: rawCounts.importPending || 0,
        completed: importDone,
        imported: rawCounts.imported || 0,
        failed: rawCounts.importFailed || 0,
        skipped: rawCounts.importSkipped || 0,
        percentage: percent(importDone, total),
      },
      postImport: {
        total,
        pending: rawCounts.postImportPending || 0,
        queued: rawCounts.postImportQueued || 0,
        processing: rawCounts.postImportProcessing || 0,
        completed: rawCounts.postImportCompleted || 0,
        failed: rawCounts.postImportFailed || 0,
        skipped: rawCounts.postImportSkipped || 0,
        percentage: percent(mappingDone, total),
      },
    },
    issues: {
      total: issueCounts.total || 0,
      open: issueCounts.OPEN || 0,
      resolved: issueCounts.RESOLVED || 0,
      ignored: issueCounts.IGNORED || 0,
    },
    percentage: percent(parsedDone + importDone + mappingDone, total * 3),
    isTerminal: isTerminalJobStatus(job.status) && mappingDone >= total,
    updatedAt: new Date(),
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
  const job = await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  const result = await issueRepository.listByJob(jobId, params);
  return {
    ...result,
    items: (result.items || []).map((issue) => ({ ...issue, shopId: job.shopId })),
  };
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

async function enrichIssuePageWithShopIds(result) {
  const items = result.items || [];
  const jobIds = unique(items.map((issue) => issue.importJobId));
  if (jobIds.length === 0) return result;

  const jobs = await jobRepository.findShopIdsByIds(jobIds);
  const shopIdByJobId = new Map(jobs.map((job) => [toId(job), toId(job.shopId)]));
  return {
    ...result,
    items: items.map((issue) => ({
      ...issue,
      shopId: shopIdByJobId.get(toId(issue.importJobId)) || null,
    })),
  };
}

async function listImportJobs(params = {}, authContext = {}) {
  const shopIds = getReadableShopIds(authContext);
  if (shopIds === null) return jobRepository.list(params);
  if (shopIds.length === 0) return emptyPage(params);

  if (params.shopId) {
    if (!shopIds.includes(String(params.shopId))) return emptyPage(params);
    return jobRepository.list(params);
  }

  return jobRepository.list({ ...params, shopIds });
}

async function listIssues(params = {}, authContext = {}) {
  const { shopId, ...issueParams } = params;
  const shopIds = getReadableShopIds(authContext);
  if (!shopId && shopIds === null) {
    return enrichIssuePageWithShopIds(await issueRepository.list(issueParams));
  }
  if (shopIds !== null && shopIds.length === 0) return emptyPage(params);

  if (shopId && shopIds !== null && !shopIds.includes(String(shopId))) {
    return emptyPage(params);
  }

  if (shopId) {
    const importJobIds = (await jobRepository.findIds({ shopId })).map(String);
    if (importJobIds.length === 0) return emptyPage(params);
    if (issueParams.importJobId && !importJobIds.includes(String(issueParams.importJobId))) {
      return emptyPage(params);
    }
    return enrichIssuePageWithShopIds(await issueRepository.list(issueParams.importJobId
      ? issueParams
      : { ...issueParams, importJobIds }));
  }

  const importJobIds = (await jobRepository.findIds({ shopIds })).map(String);
  if (importJobIds.length === 0) return emptyPage(params);

  if (issueParams.importJobId && !importJobIds.includes(String(issueParams.importJobId))) {
    return emptyPage(params);
  }

  return enrichIssuePageWithShopIds(await issueRepository.list(issueParams.importJobId
    ? issueParams
    : { ...issueParams, importJobIds }));
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

async function updateIssueStatus(issueId, { status, note }, authContext = {}) {
  const issue = await issueRepository.findById(issueId);
  if (!issue) throw notFound('Import issue not found');

  await loadAuthorizedImportJob(issue.importJobId, ORDER_WRITE_PERMISSION, authContext);
  if (issue.status !== externalOrderImportIssueStatuses.OPEN) {
    throw conflict('Import issue is already closed');
  }

  const updated = await issueRepository.transitionOpen(issueId, {
    status,
    resolutionNote: note,
    resolvedBy: authContext.accountId,
    resolvedAt: new Date(),
  });
  if (!updated) throw conflict('Import issue is already closed');
  return updated;
}

async function listImportJobRawRecords(jobId, params, authContext) {
  await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  return rawRecordRepository.listByJob(jobId, params);
}

async function retryPostImportRawRecords(jobId, rawRecordIds = [], authContext) {
  await loadAuthorizedImportJob(jobId, ORDER_WRITE_PERMISSION, authContext);
  const records = await rawRecordRepository.findByIds(unique(rawRecordIds));
  const ownedRecords = records.filter((record) => String(record.importJobId) === String(jobId));
  const results = [];

  for (const record of ownedRecords) {
    if (record.importStatus !== externalOrderRawRecordImportStatuses.IMPORTED || !record.orderItemId) {
      results.push({
        rawRecordId: toId(record),
        queued: false,
        errorCode: 'RAW_RECORD_NOT_READY',
        errorMessage: 'Raw record must be imported and linked to an order item before post-import retry',
      });
      continue;
    }

    const result = await postImportMappingQueue.enqueuePostImportMappingJob({
      importJobId: jobId,
      rawRecordId: toId(record),
      rawRecordIds: [toId(record)],
      orderId: record.orderId,
      orderItemId: record.orderItemId,
      externalOrderId: record.externalOrderId,
      externalItemId: record.externalItemId,
      source: 'EXTERNAL_ORDER_IMPORT_MANUAL_RETRY',
    }, { force: true });

    results.push({
      rawRecordId: toId(record),
      ...result,
    });
  }

  return {
    requestedCount: rawRecordIds.length,
    eligibleCount: ownedRecords.length,
    queuedCount: results.filter((result) => result.queued).length,
    items: results,
  };
}

async function processImportJob(jobId, authContext = {}) {
  const job = authContext.system === true
    ? await loadImportJob(jobId)
    : await loadAuthorizedImportJob(jobId, ORDER_WRITE_PERMISSION, authContext);
  await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.IMPORTING, {
    startedAt: new Date(),
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
  });

  try {
    if (typeof manualExcelImportService.prepareRawRecordsForJob === 'function') {
      await manualExcelImportService.prepareRawRecordsForJob(job);
    }
    const importJob = await loadImportJob(jobId);
    await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.IMPORTING);
    const replayResult = typeof manualExcelImportService.retryManualImportJob === 'function'
      ? await manualExcelImportService.retryManualImportJob(importJob)
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
      const canRetryPostImport = rawRecord.postImportStatus === externalOrderPostImportStatuses.FAILED
        || queuedStale
        || processingStale;
      if (!canRetryPostImport || !rawRecord.orderItemId) continue;

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

    const counters = summarizeRawRecordCounters(rawRecords);
    await jobRepository.updateCounters(jobId, counters);
    const openIssues = await issueRepository.listByJob(jobId, {
      status: externalOrderImportIssueStatuses.OPEN,
      page: 1,
      limit: 1,
    });
    const noPersistedSourceToReplay = (
      job.status === externalOrderImportJobStatuses.FAILED
      && rawRecords.length === 0
      && (replayResult.replayedRawRecords || 0) === 0
    );
    const status = noPersistedSourceToReplay
      ? externalOrderImportJobStatuses.FAILED
      : counters.failedCount > 0 || openIssues.total > 0
        ? externalOrderImportJobStatuses.PARTIAL_FAILED
        : externalOrderImportJobStatuses.COMPLETED;
    const finalPatch = {
      finishedAt: new Date(),
      ...(noPersistedSourceToReplay && {
        errorCode: 'NO_RETRYABLE_RECORDS',
        errorMessage: 'The failed source has no persisted records to replay',
      }),
    };
    await jobRepository.updateStatus(jobId, status, finalPatch);

    return {
      jobId,
      status,
      replayedRawRecords: replayResult.replayedRawRecords || 0,
      requeuedPostImportJobs,
      skippedCompletedRecords,
    };
  } catch (error) {
    const rawRecords = await rawRecordRepository.listAllByJob(jobId);
    await jobRepository.updateCounters(jobId, summarizeRawRecordCounters(rawRecords));
    await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.FAILED, {
      errorCode: error.code || errorCodes.APP_ERROR,
      errorMessage: error.message || String(error),
      finishedAt: new Date(),
    });
    throw error;
  }
}

async function retryImportJob(jobId, authContext) {
  if (authContext?.system === true) return processImportJob(jobId, authContext);
  const job = await loadAuthorizedImportJob(jobId, ORDER_WRITE_PERMISSION, authContext);
  await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.PENDING, {
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
  });
  await externalOrderImportQueue.enqueueImportJob({ jobId });
  return { jobId, status: externalOrderImportJobStatuses.PENDING, replayedRawRecords: 0 };
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
      record.normalizeStatus === externalOrderRawRecordNormalizeStatuses.FAILED
      || record.importStatus === externalOrderRawRecordImportStatuses.FAILED
    )).length,
  };
}

async function recoverStaleImportJobs({ staleMinutes = 30, limit = 50 } = {}) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const jobs = await jobRepository.listStaleActive({ cutoff, limit });
  const results = [];

  for (const job of jobs) {
    const jobId = toId(job);
    const retryResult = await processImportJob(jobId, {
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
  getImportJobProgress,
  listImportJobs,
  listIssues,
  listImportJobIssues,
  listImportJobRawRecords,
  listOpenIssuesForExternalItem,
  processImportJob,
  recoverStaleImportJobs,
  retryPostImportRawRecords,
  retryImportJob,
  updateIssueStatus,
};
