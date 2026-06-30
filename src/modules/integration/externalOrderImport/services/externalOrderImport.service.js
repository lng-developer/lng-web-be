const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');
const jobRepository = require('../repositories/externalOrderImportJob.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const manualExcelImportService = require('../sources/manualExcel/manualExcelImport.service');
const {
  externalOrderImportIssueStatuses,
} = require('../constants/externalOrderImportIssueTypes');

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function importFromManualExcel(payload) {
  return manualExcelImportService.importManualExcelOrderReport(payload);
}

async function importFromEtsySoldOrderItems(payload) {
  return manualExcelImportService.importEtsySoldOrderItems(payload);
}

async function getImportJob(jobId) {
  const job = await jobRepository.findById(jobId);

  if (!job) {
    throw notFound('Import job not found');
  }

  return job;
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

async function retryImportJob() {
  throw new AppError('Retry import job is not implemented', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

module.exports = {
  importFromEtsySoldOrderItems,
  importFromManualExcel,
  getImportJob,
  listIssues,
  listImportJobIssues,
  listImportJobRawRecords,
  listOpenIssuesForExternalItem,
  retryImportJob,
};
