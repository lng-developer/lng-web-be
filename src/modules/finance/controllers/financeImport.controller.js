const httpStatus = require('../../../shared/constants/httpStatus');
const fs = require('fs');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const importService = require('../services/financeImport.service');
const {
  financeImportContextSchema,
  importBatchParamsSchema,
  importedDataParamsSchema,
  listImportBatchesQuerySchema,
  listImportedDataQuerySchema,
} = require('../validators/financeSnapshot.validator');
const { assertValid } = require('./requestValidation');

function missingFileError() {
  return new AppError('Import file is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
}

function assertFile(file) {
  if (!file || !file.path) throw missingFileError();
}

async function cleanupFile(file) {
  if (!file || !file.path) return;
  await fs.promises.rm(file.path, { force: true });
}

function getContext(req) {
  const source = { ...req.query, ...req.body };
  if (!source.sourceRef && req.file?.originalname) {
    source.sourceRef = req.file.originalname;
  }
  return assertValid(financeImportContextSchema, source);
}

async function runImport(req, res, importer) {
  const context = getContext(req);
  try {
    assertFile(req.file);
    const data = await importer(req.file, context, req.auth);
    res.status(httpStatus.OK).json({ success: true, data });
  } finally {
    await cleanupFile(req.file);
  }
}

async function importTransactions(req, res) {
  await runImport(req, res, importService.importTransactionsFromFile);
}

async function importSettlements(req, res) {
  await runImport(req, res, importService.importSettlementsFromFile);
}

async function importAds(req, res) {
  await runImport(req, res, importService.importAdsFromFile);
}

async function listImportBatches(req, res) {
  const query = assertValid(listImportBatchesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.listImportBatches(query, req.auth),
  });
}

async function getImportBatch(req, res) {
  const params = assertValid(importBatchParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.getImportBatch(params.batchId, req.auth),
  });
}

async function reprocessImportBatch(req, res) {
  const params = assertValid(importBatchParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.retryImportBatch(params.batchId, req.auth),
  });
}

async function listImportedData(req, res) {
  const params = assertValid(importedDataParamsSchema, req.params);
  const query = assertValid(listImportedDataQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.listImportedData(params.sourceType, query, req.auth),
  });
}

module.exports = {
  importAds,
  importSettlements,
  importTransactions,
  getImportBatch,
  listImportBatches,
  listImportedData,
  reprocessImportBatch,
};
