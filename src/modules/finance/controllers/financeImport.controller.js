const httpStatus = require('../../../shared/constants/httpStatus');
const fs = require('fs');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const importService = require('../services/financeImport.service');
const { financeImportContextSchema } = require('../validators/financeSnapshot.validator');
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
    const data = await importer(req.file.path, context, req.auth);
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

module.exports = {
  importAds,
  importSettlements,
  importTransactions,
};
