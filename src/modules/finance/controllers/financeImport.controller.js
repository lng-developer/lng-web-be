const httpStatus = require('../../../shared/constants/httpStatus');
const fs = require('fs');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const importService = require('../services/financeImport.service');
const {
  financeImportContextSchema,
  completedSettlementImportParamsSchema,
  importBatchParamsSchema,
  importedDataParamsSchema,
  listImportBatchesQuerySchema,
  listImportedDataQuerySchema,
  listSettlementsQuerySchema,
  settlementParamsSchema,
  reconcileSettlementSchema,
  refundParamsSchema,
  refundOrderItemParamsSchema,
  allocateRefundSchema,
} = require('../validators/financeSnapshot.validator');
const settlementService = require('../services/financeSettlement.service');
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

function trustedExtensionShopId(auth = {}) {
  if (auth.tokenType !== 'EXTENSION') return null;
  return auth.scopes?.find((scope) => scope.scopeType === 'shop')?.scopeId || null;
}

function getContext(req) {
  const source = { ...req.query, ...req.body };
  if (!source.sourceRef && req.file?.originalname) {
    source.sourceRef = req.file.originalname;
  }
  return assertValid(financeImportContextSchema, {
    ...source,
    shopId: trustedExtensionShopId(req.auth) || source.shopId,
  });
}

function boundedAuditText(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function getHttpContext(req) {
  return {
    requestId: boundedAuditText(req.id, 200),
    ipAddress: boundedAuditText(req.ip, 100),
    userAgent: boundedAuditText(req.get('user-agent'), 500),
  };
}

function auditAuth(req) {
  return { ...req.auth, source: 'HTTP', auditContext: getHttpContext(req) };
}

async function runImport(req, res, importer) {
  const context = getContext(req);
  try {
    assertFile(req.file);
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim() || null;
    const data = idempotencyKey
      ? await importer(req.file, context, req.auth, getHttpContext(req), {
        async: true,
        idempotencyKey,
      })
      : await importer(req.file, context, req.auth, getHttpContext(req));
    res.status(data.status === 'QUEUED' ? httpStatus.ACCEPTED : httpStatus.OK).json({ success: true, data });
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

async function hasCompletedSettlementImport(req, res) {
  const { referenceId } = assertValid(completedSettlementImportParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.hasCompletedSettlementImport(referenceId, req.auth),
  });
}

async function importAds(req, res) {
  await runImport(req, res, importService.importAdsFromFile);
}

async function listImportBatches(req, res) {
  const query = assertValid(listImportBatchesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.listImportBatches(query, auditAuth(req)),
  });
}

async function getImportBatch(req, res) {
  const params = assertValid(importBatchParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.getImportBatch(params.batchId, auditAuth(req)),
  });
}

async function reprocessImportBatch(req, res) {
  const params = assertValid(importBatchParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.retryImportBatch(params.batchId, req.auth, getHttpContext(req)),
  });
}

async function listImportedData(req, res) {
  const params = assertValid(importedDataParamsSchema, req.params);
  const query = assertValid(listImportedDataQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await importService.listImportedData(params.sourceType, query, auditAuth(req)),
  });
}

async function listSettlements(req, res) {
  const query = assertValid(listSettlementsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await settlementService.listSettlements(query, req.auth),
  });
}

async function getSettlement(req, res) {
  const params = assertValid(settlementParamsSchema, req.params);
  const query = assertValid(listImportedDataQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await settlementService.getSettlement(params.settlementId, query, req.auth),
  });
}

async function reconcileSettlement(req, res) {
  const params = assertValid(settlementParamsSchema, req.params);
  const input = assertValid(reconcileSettlementSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await settlementService.reconcileSettlement(params.settlementId, input, req.auth, getHttpContext(req)),
  });
}
async function allocateRefund(req, res) {
  const { refundId } = assertValid(refundParamsSchema, req.params);
  const { allocations } = assertValid(allocateRefundSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await importService.allocateRefund(refundId, allocations, req.auth, getHttpContext(req)) });
}
async function listUnallocatedRefunds(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await importService.listUnallocatedRefunds(req.query, req.auth) });
}
async function listRefundReviews(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await importService.listRefundReviews(req.query, req.auth) });
}
async function confirmRefund(req, res) {
  const { orderItemId } = assertValid(refundOrderItemParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await importService.confirmRefund(orderItemId, req.auth, getHttpContext(req)) });
}

module.exports = {
  importAds,
  importSettlements,
  importTransactions,
  getImportBatch,
  hasCompletedSettlementImport,
  listImportBatches,
  listImportedData,
  listSettlements,
  getSettlement,
  reconcileSettlement,
  allocateRefund,
  listUnallocatedRefunds,
  listRefundReviews,
  confirmRefund,
  reprocessImportBatch,
};
