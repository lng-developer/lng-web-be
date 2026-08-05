const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');
const service = require('../services/externalOrderImport.service');
const {
  toImportJobDto,
  toPaginatedDto,
  toIssueDto,
  toRawRecordDto,
} = require('../dtos/externalOrderImport.dto');
const {
  issueListQuerySchema,
  issueIdParamSchema,
  issueUpdateSchema,
  jobIdParamSchema,
  importJobListQuerySchema,
  manualExcelImportSchema,
  paginationQuerySchema,
  rawRecordListQuerySchema,
  validate,
} = require('../validators/externalOrderImport.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

function getUploadBuffer(req, body) {
  if (req.file && req.file.buffer) {
    return req.file.buffer;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (body.fileBase64) {
    return Buffer.from(body.fileBase64, 'base64');
  }

  if (body.fileContent !== undefined) {
    return Buffer.from(body.fileContent, 'utf8');
  }

  throw new AppError('file, fileContent, or fileBase64 is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, {
    field: 'file',
  });
}

async function importManualExcel(req, res) {
  const requestBody = Buffer.isBuffer(req.body) ? (req.query || {}) : (req.body || {});
  const bodySource = {
    ...requestBody,
    originalFilename: (req.file && req.file.originalname) || requestBody.originalFilename,
    mimeType: (req.file && req.file.mimetype) || requestBody.mimeType,
  };
  const body = assertValid(manualExcelImportSchema, bodySource);
  const result = await service.importFromManualExcel({
    ...body,
    buffer: getUploadBuffer(req, body),
    triggeredBy: req.auth && req.auth.accountId,
  }, req.auth);

  res.status(httpStatus.ACCEPTED).json({ success: true, data: result });
}

async function importEtsySoldOrderItems(req, res) {
  const requestBody = Buffer.isBuffer(req.body) ? (req.query || {}) : (req.body || {});
  const bodySource = {
    ...requestBody,
    originalFilename: (req.file && req.file.originalname) || requestBody.originalFilename,
    mimeType: (req.file && req.file.mimetype) || requestBody.mimeType,
  };
  const body = assertValid(manualExcelImportSchema, bodySource);
  const result = await service.importFromEtsySoldOrderItems({
    ...body,
    buffer: getUploadBuffer(req, body),
    triggeredBy: req.auth && req.auth.accountId,
  }, req.auth);

  res.status(httpStatus.ACCEPTED).json({ success: true, data: result });
}

async function getImportJob(req, res) {
  const { jobId } = assertValid(jobIdParamSchema, req.params);
  const job = await service.getImportJob(jobId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toImportJobDto(job) });
}

async function listImportJobs(req, res) {
  const query = assertValid(importJobListQuerySchema, req.query);
  const result = await service.listImportJobs(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toImportJobDto) });
}

async function listImportJobIssues(req, res) {
  const { jobId } = assertValid(jobIdParamSchema, req.params);
  const query = assertValid(paginationQuerySchema, req.query);
  const result = await service.listImportJobIssues(jobId, query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toIssueDto) });
}

async function listIssues(req, res) {
  const query = assertValid(issueListQuerySchema, req.query);
  const result = await service.listIssues(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toIssueDto) });
}

async function listImportJobRawRecords(req, res) {
  const { jobId } = assertValid(jobIdParamSchema, req.params);
  const query = assertValid(rawRecordListQuerySchema, req.query);
  const result = await service.listImportJobRawRecords(jobId, query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toRawRecordDto) });
}

async function retryImportJob(req, res) {
  const { jobId } = assertValid(jobIdParamSchema, req.params);
  const result = await service.retryImportJob(jobId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateIssueStatus(req, res) {
  const { issueId } = assertValid(issueIdParamSchema, req.params);
  const input = assertValid(issueUpdateSchema, req.body);
  const result = await service.updateIssueStatus(issueId, input, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toIssueDto(result) });
}

module.exports = {
  importEtsySoldOrderItems,
  importManualExcel,
  getImportJob,
  listImportJobs,
  listIssues,
  listImportJobIssues,
  listImportJobRawRecords,
  retryImportJob,
  updateIssueStatus,
};
