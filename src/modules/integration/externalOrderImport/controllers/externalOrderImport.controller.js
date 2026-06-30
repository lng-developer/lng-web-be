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
  jobIdParamSchema,
  manualExcelImportSchema,
  paginationQuerySchema,
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
  });

  res.status(httpStatus.CREATED).json({ success: true, data: result });
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
  });

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getImportJob(req, res) {
  const { jobId } = assertValid(jobIdParamSchema, req.params);
  const job = await service.getImportJob(jobId);

  res.status(httpStatus.OK).json({ success: true, data: toImportJobDto(job) });
}

async function listImportJobIssues(req, res) {
  const { jobId } = assertValid(jobIdParamSchema, req.params);
  const query = assertValid(paginationQuerySchema, req.query);
  const result = await service.listImportJobIssues(jobId, query);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toIssueDto) });
}

async function listIssues(req, res) {
  const query = assertValid(issueListQuerySchema, req.query);
  const result = await service.listIssues(query);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toIssueDto) });
}

async function listImportJobRawRecords(req, res) {
  const { jobId } = assertValid(jobIdParamSchema, req.params);
  const query = assertValid(paginationQuerySchema, req.query);
  const result = await service.listImportJobRawRecords(jobId, query);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toRawRecordDto) });
}

module.exports = {
  importEtsySoldOrderItems,
  importManualExcel,
  getImportJob,
  listIssues,
  listImportJobIssues,
  listImportJobRawRecords,
};
