const AppError = require('../../../shared/errors/appError');
const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
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
const { enqueueFinanceImport } = require('./financeImportQueue.service');
const { enqueueSnapshotRecalculation } = require('./financeSnapshotQueue.service');
const adsUnassignedRowRepository = require('../repositories/adsUnassignedRow.repository');
const financeAccess = require('./financeAccess.service');
const adsShopMappingService = require('./adsShopMapping.service');
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
    allowedAdsImportKeys: Array.isArray(context.allowedAdsImportKeys) ? context.allowedAdsImportKeys : null,
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
  const summary = {
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
  Object.defineProperty(summary, 'affectedOrderItemIds', {
    value: new Set(),
    enumerable: false,
    writable: true,
  });
  Object.defineProperty(summary, 'refundOrderIdentities', {
    value: new Map(),
    enumerable: false,
  });
  return summary;
}

function summaryFromParsed(context, parsed = {}) {
  const summary = createSummary(context);
  const errors = parsed.errors || [];
  const rejectedRows = new Set(errors.map((error) => error.row)).size;
  summary.processedRows = (parsed.rows || []).length + rejectedRows;
  summary.skippedRows = rejectedRows;
  summary.errors.push(...errors);
  return summary;
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
      ...(row.dedupKey ? { dedupKey: row.dedupKey } : {}),
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
  ]
    .filter(([, amount]) => amount)
    .map(([feeType, amount]) => [feeType, -amount]);
}

function isRefundRow(row) {
  const type = String(row.transactionType || '').toUpperCase();
  return type.includes('REFUND') || row.totalAmount < 0 && type.includes('RETURN');
}

function distributeRefundsAcrossItems(refunds, items) {
  const remainingByItem = items.map((item) => ({
    orderItemId: String(item._id || item.id),
    amount: expectedCustomerChargeAmount(item),
  }));
  let itemIndex = 0;
  return refunds.map((refund) => {
    let remaining = refund.totalRefundAmount;
    const allocations = [];
    while (remaining > 0 && itemIndex < remainingByItem.length) {
      const item = remainingByItem[itemIndex];
      const amount = Math.min(remaining, item.amount);
      if (amount > 0) allocations.push({ orderItemId: item.orderItemId, amount });
      remaining -= amount;
      item.amount -= amount;
      if (item.amount === 0) itemIndex += 1;
    }
    return remaining === 0 ? allocations : null;
  });
}

async function autoConfirmExactOrderRefund(identity, summary, authContext) {
  const refunds = await repository.listUnallocatedOrderRefunds(identity);
  if (!refunds.length || refunds.some((refund) => refund.sku || refund.externalItemId)) return 0;
  const order = await orderPublic.findByExternalIdentity(identity);
  if (!order) return 0;
  const items = await orderPublic.listItemsByOrder(order._id || order.id);
  const expectedAmount = items.reduce((total, item) => total + expectedCustomerChargeAmount(item), 0);
  const refundAmount = refunds.reduce((total, refund) => total + refund.totalRefundAmount, 0);
  const currency = String(refunds[0].currency || 'USD').toUpperCase();
  if (!items.length || items.some((item) => expectedCustomerChargeAmount(item) <= 0
    || String(item.price?.currency || 'USD').toUpperCase() !== currency)
    || expectedAmount !== refundAmount) return 0;

  const allocationsByRefund = distributeRefundsAcrossItems(refunds, items);
  if (allocationsByRefund.some((allocations) => !allocations)) return 0;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (let index = 0; index < refunds.length; index += 1) {
        const saved = await repository.setRefundAllocationsIfUnallocated(
          String(refunds[index]._id),
          refunds[index].totalRefundAmount,
          allocationsByRefund[index],
          { session },
        );
        if (!saved) throw appError('Refund was already allocated', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
      }
      for (const item of items) {
        const orderItemId = String(item._id || item.id);
        await orderPublic.transitionItemStatus(orderItemId, 'REFUNDED', {
          source: 'FINANCE_ORDER_REFUND_IMPORT',
          actorId: authContext?.accountId || null,
          allowFinancialRefundConfirmation: true,
          session,
        });
        summary.affectedOrderItemIds.add(orderItemId);
      }
    });
  } finally {
    await session.endSession();
  }
  await orderPublic.ensureOpenOrderCase({
    orderId: String(order._id || order.id),
    caseType: 'REFUND',
    severity: 'MEDIUM',
    title: 'Confirmed full order refund',
    description: 'An order-level finance transaction exactly matches every item charge. Fulfillment history remains unchanged.',
  }, authContext || { system: true });
  return refunds.length;
}

async function processTransactionRow(row, context, summary, authContext) {
  try {
    const item = await findLinkedItem(row, context);
    if (item?._id || item?.id) summary.affectedOrderItemIds.add(String(item._id || item.id));
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
          rawReference: {
            importKey: `${row.importKey}:${feeType}`,
            ...(row.dedupKey ? { dedupKey: `${row.dedupKey}:${feeType}` } : {}),
            raw: row.raw,
          },
          feeType,
          feeCategory: 'MARKETPLACE',
          description: row.description || null,
          feeAmount: amount,
          taxAmount: 0,
          totalFeeAmount: amount,
        });
        summary.upserted.feeLines += 1;
      }
    }

    if (isRefundRow(row)) {
      const amount = Math.abs(row.totalAmount || row.productSalesAmount || 0);
      if (!context.dryRun && amount > 0) {
        const refund = await repository.upsertRefundRecord({
          ...payload,
          externalRefundId: `${row.dedupKey || `${context.sourceRef}:${row.importKey}`}:REFUND`,
          refundType: 'REFUND',
          refundAmount: amount,
          shippingRefundAmount: 0,
          taxRefundAmount: 0,
          adjustmentRefundAmount: 0,
          totalRefundAmount: amount,
          refundedAt: row.postedAt || new Date(),
        });
        summary.upserted.refundRecords += 1;
        if (!row.sku && !row.externalItemId && row.externalOrderId) {
          const identity = {
            shopId: context.shopId,
            salesChannelCode: context.salesChannelCode,
            marketplaceCode: context.marketplaceCode,
            externalOrderId: row.externalOrderId,
          };
          summary.refundOrderIdentities.set(JSON.stringify(identity), identity);
        }
      }
    }
  } catch (error) {
    summary.skippedRows += 1;
    summary.errors.push({ row: row.importKey, message: error.message });
  }
}

async function importTransactions(text, rawContext = {}, authContext, onProgress = async () => {}) {
  const context = normalizeContext(rawContext, authContext);
  const parsed = parseTransactionCsv(text);
  const { rows } = parsed;
  const summary = summaryFromParsed(context, parsed);
  let completed = 0;
  let lastReportedAt = Date.now();
  await onProgress({ processedRows: 0, validRows: 0, skippedRows: 0, errorCount: summary.errors.length });
  for (const row of rows) {
    await processTransactionRow(row, context, summary, authContext);
    completed += 1;
    if (completed === 1 || completed === rows.length || completed % 25 === 0 || Date.now() - lastReportedAt >= 10000) {
      await onProgress({ processedRows: completed, validRows: summary.validRows, skippedRows: summary.skippedRows, errorCount: summary.errors.length });
      lastReportedAt = Date.now();
    }
  }

  if (!context.dryRun) {
    for (const identity of summary.refundOrderIdentities.values()) {
      const reconciledRows = await autoConfirmExactOrderRefund(identity, summary, authContext);
      summary.unlinkedRows = Math.max(summary.unlinkedRows - reconciledRows, 0);
    }
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
    if (item?._id || item?.id) summary.affectedOrderItemIds.add(String(item._id || item.id));
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

async function importSettlements(text, rawContext = {}, authContext, onProgress = async () => {}) {
  const context = normalizeContext(rawContext, authContext);
  const parsed = parseSettlementTxt(text);
  const { rows } = parsed;
  const summary = summaryFromParsed(context, parsed);

  let completed = 0;
  let lastReportedAt = Date.now();
  await onProgress({ processedRows: 0, validRows: 0, skippedRows: 0, errorCount: summary.errors.length });
  for (const row of rows) {
    await processSettlementRow(row, context, summary);
    completed += 1;
    if (completed === 1 || completed === rows.length || completed % 25 === 0 || Date.now() - lastReportedAt >= 10000) {
      await onProgress({ processedRows: completed, validRows: summary.validRows, skippedRows: summary.skippedRows, errorCount: summary.errors.length });
      lastReportedAt = Date.now();
    }
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
  const allowedImportKeys = context.allowedAdsImportKeys && new Set(context.allowedAdsImportKeys);
  const parsed = parseAdsCsv(text);
  const rows = parsed.rows.filter((row) => !allowedImportKeys || allowedImportKeys.has(row.importKey));
  const summary = summaryFromParsed(context, { ...parsed, rows });

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

function contentHashForFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.once('error', reject);
    hash.once('error', reject);
    hash.once('finish', () => resolve(hash.digest('hex')));
    stream.pipe(hash);
  });
}

function importSummary(summary, batchId) {
  const { affectedOrderItemIds, ...publicSummary } = summary;
  return {
    ...publicSummary,
    importBatchId: batchId,
    status: importStatus(summary),
  };
}

function duplicateImportResult(batch) {
  return {
    dryRun: batch.dryRun,
    sourceRef: batch.sourceRef,
    processedRows: batch.processedRows || 0,
    validRows: batch.validRows || 0,
    skippedRows: batch.skippedRows || 0,
    upserted: batch.upserted || {},
    unlinkedRows: batch.unlinkedRows || 0,
    errors: batch.errors || [],
    importBatchId: toId(batch),
    status: batch.status,
    duplicate: true,
  };
}

async function scheduleSnapshotRecalculations(batchId, context, summary) {
  const orderItemIds = context.dryRun ? [] : [...(summary.affectedOrderItemIds || [])];
  await repository.initializeImportBatchRecalculation(batchId, orderItemIds.length);
  if (!orderItemIds.length) return;
  const results = await Promise.all(orderItemIds.map((orderItemId) => enqueueSnapshotRecalculation({
    orderItemId,
    reason: 'FINANCE_IMPORT',
    importBatchId: batchId,
  })));
  await Promise.all(results.map((queued, index) => queued.queued
    ? null
    : repository.markImportBatchRecalculationFailed(
      batchId,
      orderItemIds[index],
      new Error('Finance snapshot queue unavailable'),
    )));
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
  existingBatch,
  idempotencyKey,
  contentHash,
}) {
  const context = normalizeContext(rawContext, authContext);
  let batch = existingBatch;
  if (!batch) {
    try {
      batch = await repository.createImportBatch({
        sourceType,
        sourceAssetId,
        originalFilename,
        contentHash,
        sourceRef: context.sourceRef,
        dryRun: context.dryRun,
        idempotencyKey: idempotencyKey || null,
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
  }
  const importBatchId = toId(batch);

  let result;
  try {
    const summary = await importerFor(sourceType)(
      await fs.promises.readFile(filePath, 'utf8'),
      { ...context, importBatchId },
      authContext,
      (progress) => repository.updateImportProgress(importBatchId, progress),
    );
    if (sourceType === importSourceTypes.TRANSACTIONS) {
      await scheduleSnapshotRecalculations(importBatchId, context, summary);
    }
    result = importSummary(summary, importBatchId);
    await repository.completeImportBatch(importBatchId, result);
  } catch (error) {
    result = {
      ...importSummary(createSummary(context), importBatchId),
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

async function importFromFile(sourceType, file, rawContext = {}, authContext, httpContext, options = {}) {
  const upload = normalizeUploadedFile(file);
  const context = normalizeContext(rawContext, authContext);
  const contentHash = await contentHashForFile(upload.path);
  const duplicate = await repository.findImportBatchByContentHash({
    shopId: context.shopId,
    sourceType,
    contentHash,
  });
  if (duplicate) return duplicateImportResult(duplicate);
  const idempotencyKey = typeof options.idempotencyKey === 'string' ? options.idempotencyKey.trim() : '';
  if (options.async && (!idempotencyKey || idempotencyKey.length > 200)) {
    throw appError('Idempotency-Key is required for async finance imports', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }
  if (options.async) {
    const existing = await repository.findImportBatchByIdempotency({
      shopId: context.shopId,
      sourceType,
      idempotencyKey,
    });
    if (existing) return queuedImportResult(existing, context);
    const active = await repository.findActiveImportBatch({ shopId: context.shopId, sourceType });
    if (active) {
      throw appError(
        'Another finance import is already running for this shop and source',
        httpStatus.CONFLICT,
        errorCodes.CONFLICT_ERROR,
        { importBatchId: toId(active) },
      );
    }
  }
  const uploadMetadata = { source: 'FINANCE_IMPORT', sourceType };
  const sourceAsset = await mediaPublic.storeAsset({
    stream: fs.createReadStream(upload.path),
    filename: upload.originalFilename,
    mimeType: upload.mimeType,
    metadata: uploadMetadata,
  });

  if (options.async) {
    let batch;
    try {
      batch = await repository.createImportBatch({
        sourceType,
        sourceAssetId: toId(sourceAsset),
        originalFilename: upload.originalFilename,
        contentHash,
        sourceRef: context.sourceRef,
        dryRun: context.dryRun,
        idempotencyKey,
        activeKey: `${context.shopId}:${sourceType}`,
        shopId: context.shopId,
        salesChannelCode: context.salesChannelCode,
        marketplaceCode: context.marketplaceCode,
        importedBy: authContext?.accountId || null,
        status: 'QUEUED',
      });
    } catch (error) {
      await mediaPublic.discardUnattachedAsset(toId(sourceAsset), uploadMetadata, 'FINANCE_IMPORT_BATCH_CREATION_FAILED').catch(() => {});
      if (error?.code === 11000) {
        const existing = await repository.findImportBatchByIdempotency({
          shopId: context.shopId, sourceType, idempotencyKey,
        });
        if (existing) return queuedImportResult(existing, context);
        const active = await repository.findActiveImportBatch({ shopId: context.shopId, sourceType });
        if (active) {
          throw appError(
            'Another finance import is already running for this shop and source',
            httpStatus.CONFLICT,
            errorCodes.CONFLICT_ERROR,
            { importBatchId: toId(active) },
          );
        }
      }
      throw error;
    }
    try {
      await enqueueFinanceImport({ batchId: toId(batch) });
    } catch (error) {
      await repository.failImportBatch(toId(batch), {
        ...createSummary(context),
        errors: [{ row: null, message: error.message }],
      });
      throw error;
    }
    return queuedImportResult(batch, context);
  }

  return runImportBatch({
    sourceType,
    sourceAssetId: toId(sourceAsset),
    originalFilename: upload.originalFilename,
    contentHash,
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

function queuedImportResult(batch, context) {
  return {
    ...importSummary(createSummary(context), toId(batch)),
    importBatchId: toId(batch),
    status: batch.status || 'QUEUED',
  };
}

async function relinkFinanceRowsForOrderItem(payload) {
  return repository.linkUnlinkedFinanceRowsForOrderItem(payload);
}

async function allocateRefund(refundId, allocations, authContext, httpContext) {
  assertGlobalAccess(financePermissions.WRITE, authContext);
  assertValidObjectId(refundId, 'refundId');
  const refund = await repository.findRefundById(refundId);
  if (!refund) throw appError('Refund not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  const merged = [...(refund.allocations || []), ...allocations].reduce((all, entry) => {
    const current = all.find((value) => String(value.orderItemId) === String(entry.orderItemId));
    if (current) current.amount += entry.amount;
    else all.push({ orderItemId: entry.orderItemId, amount: entry.amount });
    return all;
  }, []);
  const total = merged.reduce((sum, entry) => sum + entry.amount, 0);
  if (total > refund.totalRefundAmount) throw appError('Allocation exceeds refund amount', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  const items = await Promise.all(allocations.map((entry) => orderPublic.findItemById(entry.orderItemId)));
  if (items.some((item) => !item || String(item.shopId) !== String(refund.shopId) || item.salesChannelCode !== refund.salesChannelCode || item.marketplaceCode !== refund.marketplaceCode || (refund.externalOrderId && item.externalOrderId !== refund.externalOrderId))) {
    throw appError('Allocation item does not match refund order', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }
  const saved = await repository.setRefundAllocations(refundId, merged);
  await Promise.all(allocations.map((entry) => enqueueSnapshotRecalculation({ orderItemId: entry.orderItemId, reason: 'REFUND_ALLOCATION' })));
  await auditPublic.record({ actorType: authContext.accountId ? 'ACCOUNT' : 'SYSTEM', actorAccountId: authContext.accountId || null, actorSnapshot: {}, action: 'FINANCE_REFUND_ALLOCATED', entityType: 'REFUND_RECORD', entityId: String(refundId), scopeType: 'SHOP', scopeId: String(refund.shopId), outcome: 'SUCCEEDED', source: 'MANUAL', requestId: httpContext?.requestId || null, ipAddress: httpContext?.ipAddress || null, userAgent: httpContext?.userAgent || null, changes: null, metadata: { allocationCount: allocations.length, allocatedAmount: total }, deduplicationKey: `finance-refund-allocation:${refundId}:${JSON.stringify(allocations)}` }, {});
  return { id: String(saved._id), totalRefundAmount: saved.totalRefundAmount, allocatedAmount: total, remainingAmount: saved.totalRefundAmount - total, allocations: saved.allocations || [] };
}
async function listUnallocatedRefunds(query, authContext) {
  assertGlobalAccess(financePermissions.READ, authContext);
  const refunds = await repository.listUnallocatedRefunds(query);
  return Promise.all(refunds.map(async (refund) => {
    const order = refund.externalOrderId ? await orderPublic.findByExternalIdentity({ shopId: refund.shopId, salesChannelCode: refund.salesChannelCode, marketplaceCode: refund.marketplaceCode, externalOrderId: refund.externalOrderId }) : null;
    const items = order ? await orderPublic.listItemsByOrder(order._id || order.id) : [];
    const allocatedAmount = (refund.allocations || []).reduce((sum, allocation) => sum + allocation.amount, 0);
    return { id: String(refund._id), externalOrderId: refund.externalOrderId, currency: refund.currency, refundedAt: refund.refundedAt, totalRefundAmount: refund.totalRefundAmount, allocatedAmount, remainingAmount: refund.totalRefundAmount - allocatedAmount, items: items.map((item) => ({ id: String(item._id || item.id), sku: item.sku || null, quantity: item.quantity || 0 })) };
  }));
}

function expectedCustomerChargeAmount(item = {}) {
  const price = item.price || {};
  const charged = [
    price.itemPriceAmount,
    price.shippingPriceAmount,
    price.itemTaxAmount,
    price.shippingTaxAmount,
    price.giftWrapPriceAmount,
    price.giftWrapTaxAmount,
  ].reduce((total, amount) => total + Math.trunc(Number(amount) || 0), 0);
  const discounts = [price.itemPromotionDiscountAmount, price.shipPromotionDiscountAmount]
    .reduce((total, amount) => total + Math.trunc(Number(amount) || 0), 0);
  return charged - discounts;
}

async function listRefundReviews(query, authContext) {
  assertGlobalAccess(financePermissions.READ, authContext);
  const grouped = new Map();
  (await repository.listRefundReviewRecords(query)).forEach((refund) => {
    const allocations = refund.allocations?.length
      ? refund.allocations
      : refund.orderItemId ? [{ orderItemId: refund.orderItemId, amount: refund.totalRefundAmount }] : [];
    allocations.forEach((allocation) => {
      const orderItemId = String(allocation.orderItemId);
      const current = grouped.get(orderItemId) || { orderItemId, allocatedAmount: 0, refundRecordIds: [] };
      current.allocatedAmount += allocation.amount;
      current.refundRecordIds.push(String(refund._id));
      grouped.set(orderItemId, current);
    });
  });
  return Promise.all([...grouped.values()].map(async (entry) => {
    const item = await orderPublic.findItemById(entry.orderItemId);
    const originalCustomerChargeAmount = expectedCustomerChargeAmount(item);
    const reviewStatus = entry.allocatedAmount === originalCustomerChargeAmount
      ? 'EXACT_FULL'
      : entry.allocatedAmount > originalCustomerChargeAmount ? 'OVER' : 'PARTIAL';
    return {
      ...entry,
      orderId: item?.orderId ? String(item.orderId) : null,
      currency: item?.price?.currency || 'USD',
      expectedCustomerChargeAmount: originalCustomerChargeAmount,
      reviewStatus,
      canConfirmRefund: originalCustomerChargeAmount > 0 && reviewStatus === 'EXACT_FULL' && item?.status !== 'REFUNDED',
      itemStatus: item?.status || null,
    };
  }));
}

async function confirmRefund(orderItemId, authContext, httpContext) {
  assertGlobalAccess(financePermissions.WRITE, authContext);
  assertValidObjectId(orderItemId, 'orderItemId');
  const review = (await listRefundReviews({}, authContext)).find((entry) => entry.orderItemId === String(orderItemId));
  if (!review || !review.canConfirmRefund) {
    throw appError('Refund must exactly match the original customer charge before confirmation', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  }
  const item = await orderPublic.transitionItemStatus(orderItemId, 'REFUNDED', {
    source: 'FINANCE_REFUND_CONFIRMATION',
    actorId: authContext.accountId || null,
    allowFinancialRefundConfirmation: true,
  });
  const orderCase = await orderPublic.ensureOpenOrderCase({
    orderId: review.orderId,
    orderItemId,
    caseType: 'REFUND',
    severity: 'MEDIUM',
    title: 'Confirmed customer refund',
    description: 'Finance confirmed a full customer refund. Fulfillment history remains unchanged.',
  }, authContext);
  await auditPublic.record({ actorType: authContext.accountId ? 'ACCOUNT' : 'SYSTEM', actorAccountId: authContext.accountId || null, actorSnapshot: {}, action: 'FINANCE_REFUND_CONFIRMED', entityType: 'ORDER_ITEM', entityId: String(orderItemId), scopeType: 'SHOP', scopeId: String(item.shopId || ''), outcome: 'SUCCEEDED', source: 'MANUAL', requestId: httpContext?.requestId || null, ipAddress: httpContext?.ipAddress || null, userAgent: httpContext?.userAgent || null, metadata: { allocatedAmount: review.allocatedAmount, expectedCustomerChargeAmount: review.expectedCustomerChargeAmount, refundRecordIds: review.refundRecordIds }, deduplicationKey: `finance-refund-confirmed:${orderItemId}` }, {});
  return { orderItemId: String(orderItemId), status: item.status, orderCaseId: orderCase.id };
}

async function reconcileUnlinkedLedgerRows({ dateFrom, dateTo, ledgerCategory, limit = 1000, dryRun = true } = {}) {
  const rows = await repository.listUnlinkedLedgerRows({ dateFrom, dateTo, ledgerCategory, limit });
  const result = { checked: rows.length, linked: 0, unresolved: 0, dryRun };

  for (const row of rows) {
    const item = row.externalItemId || row.sku ? await findLinkedItem(row, row) : null;
    if (item?.orderId && (item._id || item.id)) {
      if (!dryRun) {
        const linked = await repository.linkLedgerRowToOrderItem({
          ledgerLineId: toId(row),
          ...linkedFields(item),
        });
        if (!linked.linked) continue;
      }
      result.linked += 1;
      continue;
    }

    result.unresolved += 1;
  }
  return result;
}

async function importTransactionsFromFile(file, rawContext = {}, authContext, httpContext, options) {
  return importFromFile(importSourceTypes.TRANSACTIONS, file, rawContext, authContext, httpContext, options);
}

async function importSettlementsFromFile(file, rawContext = {}, authContext, httpContext, options) {
  return importFromFile(importSourceTypes.SETTLEMENTS, file, rawContext, authContext, httpContext, options);
}

async function importAdsFromFile(file, rawContext = {}, authContext, httpContext) {
  return importFromFile(importSourceTypes.ADS, file, rawContext, authContext, httpContext);
}

async function importMappedAdsFromFile(file, rawContext = {}, authContext, httpContext) {
  assertGlobalAccess(financePermissions.WRITE, authContext);
  const upload = normalizeUploadedFile(file);
  const context = {
    salesChannelCode: String(rawContext.salesChannelCode || '').trim().toUpperCase(),
    marketplaceCode: String(rawContext.marketplaceCode || '').trim().toUpperCase(),
    sourceRef: String(rawContext.sourceRef || '').trim(),
  };
  if (!context.salesChannelCode || !context.marketplaceCode || !context.sourceRef) {
    throw appError('Validation failed', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }

  const groups = new Map();
  let unassignedRows = 0;
  for (const row of parseAdsCsv(await fs.promises.readFile(upload.path, 'utf8')).rows) {
    const target = await adsShopMappingService.resolveShopForAdsRow(row, context, authContext);
    if (!target.shopId) {
      unassignedRows += 1;
      await adsUnassignedRowRepository.upsertPending({
        sourceRef: context.sourceRef,
        reportDate: row.reportDate,
        advertiserAccountId: adsShopMappingService.normalizeExternalId(row.advertiserAccountId),
        campaignId: adsShopMappingService.normalizeExternalId(row.campaignId) || null,
        campaignName: row.campaignName || null,
        portfolioId: adsShopMappingService.normalizeExternalId(row.portfolioId) || null,
        portfolioName: row.portfolioName || null,
        salesChannelCode: context.salesChannelCode,
        marketplaceCode: context.marketplaceCode,
      });
      continue;
    }
    const group = groups.get(target.shopId) || [];
    group.push(row);
    groups.set(target.shopId, group);
  }

  let importedShops = 0;
  let skippedShops = 0;
  for (const [shopId, rows] of groups) {
    const sourceRef = `${context.sourceRef}:${shopId}`;
    if (await repository.findCompletedImportBatchBySourceRef(importSourceTypes.ADS, sourceRef)) {
      skippedShops += 1;
    } else {
      await importFromFile(importSourceTypes.ADS, upload, {
        ...context, shopId, sourceRef, allowedAdsImportKeys: rows.map((row) => row.importKey), dryRun: false,
      }, authContext, httpContext);
      importedShops += 1;
    }
    await Promise.all(rows.map((row) => adsUnassignedRowRepository.markResolved({
      sourceRef: context.sourceRef,
      reportDate: row.reportDate,
      advertiserAccountId: adsShopMappingService.normalizeExternalId(row.advertiserAccountId),
      campaignId: adsShopMappingService.normalizeExternalId(row.campaignId) || null,
      portfolioId: adsShopMappingService.normalizeExternalId(row.portfolioId) || null,
    })));
  }
  return { importedShops, skippedShops, unassignedRows, complete: unassignedRows === 0 };
}

async function hasCompletedAdsImportSource(sourceRef, authContext = {}) {
  assertGlobalAccess(financePermissions.WRITE, authContext);
  return Boolean(await repository.findCompletedImportBatchBySourceRef(importSourceTypes.ADS, String(sourceRef || '').trim()));
}

async function hasCompletedSettlementImport(referenceId, authContext = {}) {
  const shopId = trustedExtensionShopId(authContext);
  if (!shopId) throw forbidden();
  assertValidObjectId(shopId, 'shopId');
  return { completed: Boolean(await repository.findCompletedSettlementImport({ shopId, referenceId })) };
}

async function listAdsUnassignedRows(query = {}, authContext = {}) {
  assertGlobalAccess(financePermissions.READ, authContext);
  return adsUnassignedRowRepository.list(query);
}

async function listImportBatches(query = {}, authContext) {
  assertGlobalAccess(financePermissions.READ, authContext);
  const result = toPaginatedImportResponse(
    await repository.listImportBatches(query),
    toImportBatchDto,
  );
  return result;
}

async function getImportBatch(batchId, authContext) {
  const extensionShopId = trustedExtensionShopId(authContext);
  if (!extensionShopId) assertGlobalAccess(financePermissions.READ, authContext);
  assertValidObjectId(batchId, 'batchId');
  const batch = await repository.findImportBatchById(batchId);
  if (!batch) {
    throw appError('Finance import batch not found', httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
  }
  if (extensionShopId) assertImportAccess({ shopId: batch.shopId }, authContext);
  const result = toImportBatchDto(batch);
  return result;
}

async function listImportedData(sourceType, query = {}, authContext) {
  assertGlobalAccess(financePermissions.READ, authContext);
  const result = toPaginatedImportResponse(
    await repository.listImportedData(sourceType, query),
    toImportedDataDto,
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
  return mediaPublic.withAssetLocalReadFile(sourceBatch.sourceAssetId, async ({ localPath }) => runImportBatch({
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
    contentHash: sourceBatch.contentHash || await contentHashForFile(localPath),
  }));
}

async function processQueuedImportBatch(batchId) {
  const sourceBatch = await repository.findImportBatchById(batchId);
  if (!sourceBatch) throw new Error(`Finance import batch ${batchId} not found`);
  const batch = await repository.claimQueuedImportBatch(batchId);
  if (!batch) return sourceBatch;
  try {
    return await mediaPublic.withAssetLocalReadFile(sourceBatch.sourceAssetId, async ({ localPath }) => runImportBatch({
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
      authContext: { system: true, worker: true },
      httpContext: null,
      existingBatch: batch,
      sourceImportBatchId: batchId,
      contentHash: sourceBatch.contentHash || await contentHashForFile(localPath),
    }));
  } catch (error) {
    await repository.failImportBatch(batchId, {
      ...createSummary({
        dryRun: sourceBatch.dryRun,
        sourceRef: sourceBatch.sourceRef,
      }),
      errors: [{ row: null, message: error.message }],
    }).catch(() => {});
    throw error;
  }
}

module.exports = {
  importAds,
  importAdsFromFile,
  importMappedAdsFromFile,
  hasCompletedAdsImportSource,
  hasCompletedSettlementImport,
  listAdsUnassignedRows,
  importSettlements,
  importSettlementsFromFile,
  importTransactions,
  importTransactionsFromFile,
  getImportBatch,
  listImportBatches,
  listImportedData,
  retryImportBatch,
  processQueuedImportBatch,
  reconcileUnlinkedLedgerRows,
  relinkFinanceRowsForOrderItem,
  allocateRefund,
  listUnallocatedRefunds,
  listRefundReviews,
  confirmRefund,
};
