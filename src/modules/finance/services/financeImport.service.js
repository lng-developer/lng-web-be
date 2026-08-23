const AppError = require('../../../shared/errors/appError');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/utils/logger');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const mediaPublic = require('../../media/public');
const orderPublic = require('../../order/public');
const auditPublic = require('../../audit/public');
const { financePermissions, financeSourceTypes } = require('../constants/finance.constants');
const {
  toImportBatchDto,
  toImportedDataDto,
  toPaginatedImportResponse,
} = require('../dtos/financeImport.dto');
const repository = require('../repositories/financeImport.repository');
const financeAccess = require('./financeAccess.service');
const {
  parseAdsCsv,
  parseSettlementTxt,
  parseTransactionCsv,
} = require('./financeImport.parser');

const importSourceTypes = Object.freeze({
  TRANSACTIONS: 'TRANSACTIONS',
  SETTLEMENTS: 'SETTLEMENTS',
  ADS: 'ADS',
});
const importActions = Object.freeze({
  [importSourceTypes.TRANSACTIONS]: 'FINANCE_TRANSACTIONS_IMPORTED',
  [importSourceTypes.SETTLEMENTS]: 'FINANCE_SETTLEMENTS_IMPORTED',
  [importSourceTypes.ADS]: 'FINANCE_ADS_IMPORTED',
});

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function assertGlobalAccess(permission, authContext = {}) {
  if (!financeAccess.hasGlobal(authContext, permission)) throw forbidden();
}

function assertImportAccess(context, authContext = {}) {
  if (financeAccess.hasGlobal(authContext, financePermissions.WRITE)) return;
  const canWriteShop = (financeAccess.accessConditions(authContext, financePermissions.WRITE) || [])
    .some((condition) => condition.shopId && String(condition.shopId) === String(context.shopId));
  if (!canWriteShop) throw forbidden();
}

function safeReadFilters(query = {}) {
  return Object.fromEntries([
    'sourceType', 'shopId', 'salesChannelCode', 'marketplaceCode', 'status',
    'dateFrom', 'dateTo', 'page', 'limit',
  ].filter((key) => query[key] !== undefined).map((key) => [key, query[key]]));
}

async function recordSensitiveRead(action, entityId, query, authContext = {}, metadata = {}) {
  const internal = authContext.system || authContext.worker || authContext.import;
  const actorAccountId = internal ? null : (authContext.accountId || null);
  const auditContext = authContext.auditContext || {};
  await auditPublic.record({
    actorType: actorAccountId ? 'ACCOUNT' : 'SYSTEM',
    actorAccountId,
    actorSnapshot: {},
    action,
    entityType: 'FINANCE_IMPORT',
    entityId: String(entityId),
    scopeType: query.shopId ? 'SHOP' : null,
    scopeId: query.shopId ? String(query.shopId) : null,
    outcome: 'SUCCEEDED',
    source: internal ? (authContext.source || 'SYSTEM') : 'HTTP',
    requestId: auditContext.requestId || null,
    ipAddress: auditContext.ipAddress || null,
    userAgent: auditContext.userAgent || null,
    changes: null,
    metadata: { ...safeReadFilters(query), ...metadata },
    deduplicationKey: `finance-read:${action.toLowerCase()}:${randomUUID()}`,
  }, {});
}

function isDryRun(value) {
  if (value === false || value === 'false') return false;
  return true;
}

function trustedExtensionShopId(authContext = {}) {
  if (authContext.tokenType !== 'EXTENSION') return null;
  return authContext.scopes?.find((scope) => scope.scopeType === 'shop')?.scopeId || null;
}

function normalizeContext(context = {}, authContext) {
  const shopId = trustedExtensionShopId(authContext) || context.shopId;
  assertValidObjectId(shopId, 'shopId');
  const normalized = {
    shopId,
    salesChannelCode: String(context.salesChannelCode || '').trim().toUpperCase(),
    marketplaceCode: String(context.marketplaceCode || '').trim().toUpperCase(),
    sourceRef: String(context.sourceRef || 'finance-import').trim(),
    dryRun: isDryRun(context.dryRun),
    importBatchId: context.importBatchId || null,
  };

  if (!normalized.salesChannelCode || !normalized.marketplaceCode) {
    throw appError('Validation failed', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, [
      { message: 'salesChannelCode and marketplaceCode are required' },
    ]);
  }

  assertImportAccess(normalized, authContext);
  return normalized;
}

function createSummary(context) {
  return {
    dryRun: context.dryRun,
    sourceRef: context.sourceRef,
    processedRows: 0,
    validRows: 0,
    skippedRows: 0,
    upserted: {
      settlements: 0,
      ledgerLines: 0,
      feeLines: 0,
      refundRecords: 0,
      adsRows: 0,
    },
    unlinkedRows: 0,
    errors: [],
  };
}

function linkedFields(item) {
  if (!item) return {};
  return {
    orderId: item.orderId || null,
    orderItemId: item._id || item.id || null,
    listingId: item.listingId || null,
  };
}

async function findLinkedItem(row, context) {
  if (!row.externalOrderId && !row.sku && !row.externalItemId) return null;
  return orderPublic.findItemByFinanceIdentity({
    shopId: context.shopId,
    salesChannelCode: context.salesChannelCode,
    marketplaceCode: context.marketplaceCode,
    externalOrderId: row.externalOrderId,
    sku: row.sku,
    externalItemId: row.externalItemId,
  });
}

function basePayload(context, row, item) {
  return {
    shopId: context.shopId,
    salesChannelCode: context.salesChannelCode,
    marketplaceCode: context.marketplaceCode,
    settlementId: row.settlementId || null,
    externalOrderId: row.externalOrderId || null,
    externalItemId: row.externalItemId || null,
    sku: row.sku || null,
    currency: row.currency || 'USD',
    postedAt: row.postedAt || null,
    sourceType: financeSourceTypes.IMPORT,
    sourceRef: context.sourceRef,
    importBatchId: context.importBatchId || null,
    rawReference: {
      importKey: row.importKey,
      raw: row.raw,
    },
    ...linkedFields(item),
  };
}

function feeRows(row) {
  return [
    ['SELLING_FEES', row.sellingFeesAmount],
    ['FBA_FEES', row.fbaFeesAmount],
    ['OTHER_TRANSACTION_FEES', row.otherTransactionFeesAmount],
  ].filter(([, amount]) => amount);
}

function isRefundRow(row) {
  const type = String(row.transactionType || '').toUpperCase();
  return type.includes('REFUND') || row.totalAmount < 0 && type.includes('RETURN');
}

async function processTransactionRow(row, context, summary) {
  try {
    const item = await findLinkedItem(row, context);
    if ((row.externalOrderId || row.sku) && !item) summary.unlinkedRows += 1;
    summary.validRows += 1;

    const payload = basePayload(context, row, item);
    if (!context.dryRun) {
      await repository.upsertLedgerLine({
        ...payload,
        transactionType: row.transactionType || null,
        transactionStatus: row.transactionStatus || null,
        ledgerCategory: 'TRANSACTION',
        amount: row.totalAmount || 0,
        quantityPurchased: row.quantityPurchased || null,
      });
      summary.upserted.ledgerLines += 1;
    }

    for (const [feeType, amount] of feeRows(row)) {
      if (!context.dryRun) {
        await repository.upsertFeeLine({
          ...payload,
          rawReference: { importKey: `${row.importKey}:${feeType}`, raw: row.raw },
          feeType,
          feeCategory: 'MARKETPLACE',
          description: row.description || null,
          feeAmount: Math.abs(amount),
          taxAmount: 0,
          totalFeeAmount: Math.abs(amount),
        });
        summary.upserted.feeLines += 1;
      }
    }

    if (isRefundRow(row)) {
      const amount = Math.abs(row.totalAmount || row.productSalesAmount || 0);
      if (!context.dryRun && amount > 0) {
        await repository.upsertRefundRecord({
          ...payload,
          externalRefundId: `${context.sourceRef}:${row.importKey}:REFUND`,
          refundType: 'REFUND',
          refundAmount: amount,
          shippingRefundAmount: 0,
          taxRefundAmount: 0,
          adjustmentRefundAmount: 0,
          totalRefundAmount: amount,
          refundedAt: row.postedAt || new Date(),
        });
        summary.upserted.refundRecords += 1;
      }
    }
  } catch (error) {
    summary.skippedRows += 1;
    summary.errors.push({ row: row.importKey, message: error.message });
  }
}

async function importTransactions(text, rawContext = {}, authContext) {
  const context = normalizeContext(rawContext, authContext);
  const rows = parseTransactionCsv(text);
  const summary = createSummary(context);
  summary.processedRows = rows.length;

  for (const row of rows) {
    await processTransactionRow(row, context, summary);
  }

  return summary;
}

async function processSettlementRow(row, context, summary) {
  try {
    summary.validRows += 1;
    if (row.isHeader) {
      if (!context.dryRun) {
        await repository.upsertSettlement({
          shopId: context.shopId,
          salesChannelCode: context.salesChannelCode,
          marketplaceCode: context.marketplaceCode,
          settlementId: row.settlementId || context.sourceRef,
          periodStartAt: row.periodStartAt || null,
          periodEndAt: row.periodEndAt || null,
          depositAt: row.depositAt || null,
          currency: row.currency || 'USD',
          totalAmount: row.totalAmount || 0,
          sourceType: financeSourceTypes.IMPORT,
          sourceRef: context.sourceRef,
          importBatchId: context.importBatchId || null,
          rawReference: { importKey: row.importKey, raw: row.raw },
        });
        summary.upserted.settlements += 1;
      }
      return;
    }

    const item = await findLinkedItem(row, context);
    if ((row.externalOrderId || row.sku) && !item) summary.unlinkedRows += 1;
    if (!context.dryRun) {
      await repository.upsertLedgerLine({
        ...basePayload(context, row, item),
        transactionType: row.transactionType || null,
        transactionStatus: row.transactionStatus || null,
        amountType: row.amountType || null,
        amountDescription: row.amountDescription || null,
        ledgerCategory: 'SETTLEMENT_ACTIVITY',
        amount: row.amount || 0,
        quantityPurchased: row.quantityPurchased || null,
      });
      summary.upserted.ledgerLines += 1;
    }
  } catch (error) {
    summary.skippedRows += 1;
    summary.errors.push({ row: row.importKey, message: error.message });
  }
}

async function importSettlements(text, rawContext = {}, authContext) {
  const context = normalizeContext(rawContext, authContext);
  const rows = parseSettlementTxt(text);
  const summary = createSummary(context);
  summary.processedRows = rows.length;

  for (const row of rows) {
    await processSettlementRow(row, context, summary);
  }

  return summary;
}

async function processAdsRow(row, context, summary) {
  try {
    if (!row.reportDate || !row.campaignName) {
      summary.skippedRows += 1;
      return;
    }
    summary.validRows += 1;
    if (!context.dryRun) {
      await repository.upsertAdsSpend({
        shopId: context.shopId,
        salesChannelCode: context.salesChannelCode,
        marketplaceCode: context.marketplaceCode,
        ...row,
        sourceType: financeSourceTypes.IMPORT,
        sourceRef: context.sourceRef,
        importBatchId: context.importBatchId || null,
        rawReference: { importKey: row.importKey, raw: row.raw },
      });
      summary.upserted.adsRows += 1;
    }
  } catch (error) {
    summary.skippedRows += 1;
    summary.errors.push({ row: row.importKey, message: error.message });
  }
}

async function importAds(text, rawContext = {}, authContext) {
  const context = normalizeContext(rawContext, authContext);
  const rows = parseAdsCsv(text);
  const summary = createSummary(context);
  summary.processedRows = rows.length;

  for (const row of rows) {
    await processAdsRow(row, context, summary);
  }

  return summary;
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function normalizeUploadedFile(file) {
  const filePath = typeof file === 'string' ? file : file?.path;
  if (!filePath) {
    throw appError('Import file is required', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }

  return {
    path: filePath,
    originalFilename: file?.originalname || path.basename(filePath),
    mimeType: file?.mimetype || null,
  };
}

function importStatus(summary) {
  if (summary.errors.length >= summary.processedRows && summary.errors.length > 0) return 'FAILED';
  if (summary.errors.length || summary.skippedRows) return 'PARTIAL_FAILED';
  return 'COMPLETED';
}

function importSummary(summary, batchId) {
  return {
    ...summary,
    importBatchId: batchId,
    status: importStatus(summary),
  };
}

async function recordImportAudit({
  sourceType, context, result, authContext, httpContext, sourceImportBatchId,
}) {
  const actorAccountId = authContext?.accountId || null;
  await auditPublic.record({
    actorType: actorAccountId ? 'ACCOUNT' : 'SYSTEM',
    actorAccountId,
    actorSnapshot: {},
    action: sourceImportBatchId ? 'FINANCE_IMPORT_REPROCESSED' : importActions[sourceType],
    entityType: 'FINANCE_IMPORT_BATCH',
    entityId: String(result.importBatchId),
    scopeType: 'SHOP',
    scopeId: String(context.shopId),
    outcome: result.status === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED',
    source: 'IMPORT',
    requestId: httpContext?.requestId || null,
    ipAddress: httpContext?.ipAddress || null,
    userAgent: httpContext?.userAgent || null,
    changes: null,
    metadata: {
      sourceType,
      ...(sourceImportBatchId ? { sourceImportBatchId: String(sourceImportBatchId) } : {}),
      preview: context.dryRun,
      processedRows: result.processedRows,
      acceptedRows: Math.max(result.processedRows - result.skippedRows, 0),
      rejectedRows: result.skippedRows,
      unlinkedRows: result.unlinkedRows,
    },
    deduplicationKey: `finance-import:${result.importBatchId}:${result.status.toLowerCase()}`,
  }, {});
}

async function tryRecordImportAudit(args) {
  try {
    await recordImportAudit(args);
  } catch {
    logger.warn('finance_import_audit_failed', {
      importBatchId: String(args.result.importBatchId),
      requestId: args.httpContext?.requestId || null,
      sourceType: args.sourceType,
      status: args.result.status,
    });
  }
}

function importerFor(sourceType) {
  if (sourceType === importSourceTypes.TRANSACTIONS) return importTransactions;
  if (sourceType === importSourceTypes.SETTLEMENTS) return importSettlements;
  if (sourceType === importSourceTypes.ADS) return importAds;
  throw appError('Unsupported finance import source', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
}

async function runImportBatch({
  sourceType,
  sourceAssetId,
  originalFilename,
  filePath,
  rawContext,
  authContext,
  httpContext,
  sourceImportBatchId,
  onBatchCreateError,
}) {
  const context = normalizeContext(rawContext, authContext);
  let batch;
  try {
    batch = await repository.createImportBatch({
      sourceType,
      sourceAssetId,
      originalFilename,
      sourceRef: context.sourceRef,
      dryRun: context.dryRun,
      shopId: context.shopId,
      salesChannelCode: context.salesChannelCode,
      marketplaceCode: context.marketplaceCode,
      importedBy: authContext?.accountId || null,
      status: 'PROCESSING',
    });
  } catch (error) {
    if (onBatchCreateError) await onBatchCreateError();
    throw error;
  }
  const importBatchId = toId(batch);

  let result;
  try {
    const summary = await importerFor(sourceType)(
      await fs.promises.readFile(filePath, 'utf8'),
      { ...context, importBatchId },
      authContext,
    );
    result = importSummary(summary, importBatchId);
    await repository.completeImportBatch(importBatchId, result);
  } catch (error) {
    result = {
      ...createSummary(context),
      importBatchId,
      status: 'FAILED',
      errors: [{ row: null, message: error.message }],
    };
    try {
      await repository.completeImportBatch(importBatchId, result);
    } catch {
      // The original import error is the useful failure for the caller.
    }
    await tryRecordImportAudit({
      sourceType, context, result, authContext, httpContext, sourceImportBatchId,
    });
    throw error;
  }
  await tryRecordImportAudit({
    sourceType, context, result, authContext, httpContext, sourceImportBatchId,
  });
  return result;
}

async function importFromFile(sourceType, file, rawContext = {}, authContext, httpContext) {
  const upload = normalizeUploadedFile(file);
  const context = normalizeContext(rawContext, authContext);
  const uploadMetadata = { source: 'FINANCE_IMPORT', sourceType };
  const sourceAsset = await mediaPublic.storeAsset({
    stream: fs.createReadStream(upload.path),
    filename: upload.originalFilename,
    mimeType: upload.mimeType,
    metadata: uploadMetadata,
  });

  return runImportBatch({
    sourceType,
    sourceAssetId: toId(sourceAsset),
    originalFilename: upload.originalFilename,
    filePath: upload.path,
    rawContext: context,
    authContext,
    httpContext,
    onBatchCreateError: async () => {
      try {
        await mediaPublic.discardUnattachedAsset(
          toId(sourceAsset),
          uploadMetadata,
          'FINANCE_IMPORT_BATCH_CREATION_FAILED',
        );
      } catch {
      }
    },
  });
}

async function importTransactionsFromFile(file, rawContext = {}, authContext, httpContext) {
  return importFromFile(importSourceTypes.TRANSACTIONS, file, rawContext, authContext, httpContext);
}

async function importSettlementsFromFile(file, rawContext = {}, authContext, httpContext) {
  return importFromFile(importSourceTypes.SETTLEMENTS, file, rawContext, authContext, httpContext);
}

async function importAdsFromFile(file, rawContext = {}, authContext, httpContext) {
  return importFromFile(importSourceTypes.ADS, file, rawContext, authContext, httpContext);
}

async function listImportBatches(query = {}, authContext) {
  assertGlobalAccess(financePermissions.READ, authContext);
  const result = toPaginatedImportResponse(
    await repository.listImportBatches(query),
    toImportBatchDto,
  );
  await recordSensitiveRead(
    'FINANCE_IMPORT_BATCHES_READ', 'import-batches', query, authContext,
    { rowCount: result.items.length },
  );
  return result;
}

async function getImportBatch(batchId, authContext) {
  assertGlobalAccess(financePermissions.READ, authContext);
  assertValidObjectId(batchId, 'batchId');
  const batch = await repository.findImportBatchById(batchId);
  if (!batch) {
    throw appError('Finance import batch not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  }
  const result = toImportBatchDto(batch);
  await recordSensitiveRead(
    'FINANCE_IMPORT_BATCH_READ', batchId, { shopId: String(batch.shopId) }, authContext,
    { sourceType: batch.sourceType || null },
  );
  return result;
}

async function listImportedData(sourceType, query = {}, authContext) {
  assertGlobalAccess(financePermissions.READ, authContext);
  const result = toPaginatedImportResponse(
    await repository.listImportedData(sourceType, query),
    toImportedDataDto,
  );
  await recordSensitiveRead(
    'FINANCE_IMPORTED_DATA_READ', `imported-data:${sourceType}`, { ...query, sourceType }, authContext,
    { rowCount: result.items.length },
  );
  return result;
}

async function retryImportBatch(batchId, authContext, httpContext) {
  assertGlobalAccess(financePermissions.WRITE, authContext);
  assertValidObjectId(batchId, 'batchId');
  const sourceBatch = await repository.findImportBatchById(batchId);
  if (!sourceBatch) {
    throw appError('Finance import batch not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  }
  return mediaPublic.withAssetLocalReadFile(sourceBatch.sourceAssetId, ({ localPath }) => runImportBatch({
    sourceType: sourceBatch.sourceType,
    sourceAssetId: toId(sourceBatch.sourceAssetId),
    originalFilename: sourceBatch.originalFilename,
    filePath: localPath,
    rawContext: {
      shopId: sourceBatch.shopId,
      salesChannelCode: sourceBatch.salesChannelCode,
      marketplaceCode: sourceBatch.marketplaceCode,
      sourceRef: sourceBatch.sourceRef,
      dryRun: sourceBatch.dryRun,
    },
    authContext,
    httpContext,
    sourceImportBatchId: batchId,
  }));
}

module.exports = {
  importAds,
  importAdsFromFile,
  importSettlements,
  importSettlementsFromFile,
  importTransactions,
  importTransactionsFromFile,
  getImportBatch,
  listImportBatches,
  listImportedData,
  retryImportBatch,
};
