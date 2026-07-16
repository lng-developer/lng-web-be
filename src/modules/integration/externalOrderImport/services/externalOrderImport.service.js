const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');
const jobRepository = require('../repositories/externalOrderImportJob.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const manualExcelImportService = require('../sources/manualExcel/manualExcelImport.service');
const postImportMappingQueue = require('./postImportMappingQueue.service');
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

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(toId))];
}

async function importFromManualExcel(payload) {
  return manualExcelImportService.importManualExcelOrderReport(payload);
}

async function importFromEtsySoldOrderItems(payload) {
  return manualExcelImportService.importEtsySoldOrderItems(payload);
}

async function loadImportJob(jobId) {
  const job = await jobRepository.findById(jobId);

  if (!job) {
    throw notFound('Import job not found');
  }

  return job;
}

async function getImportJob(jobId) {
  const job = await loadImportJob(jobId);

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

async function listImportJobIssues(jobId, params) {
  await getImportJob(jobId);
  return issueRepository.listByJob(jobId, params);
}

async function listIssues(params = {}) {
  return issueRepository.list(params);
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

async function listImportJobRawRecords(jobId, params) {
  await getImportJob(jobId);
  return rawRecordRepository.listByJob(jobId, params);
}

async function retryImportJob(jobId) {
  const job = await loadImportJob(jobId);
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
    if (![externalOrderPostImportStatuses.PENDING, externalOrderPostImportStatuses.FAILED].includes(rawRecord.postImportStatus)) {
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
    const retryResult = await retryImportJob(jobId);
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
