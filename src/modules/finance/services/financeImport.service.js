const AppError = require('../../../shared/errors/appError');
const fs = require('fs');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const orderPublic = require('../../order/public');
const { financePermissions, financeSourceTypes } = require('../constants/finance.constants');
const repository = require('../repositories/financeImport.repository');
const {
  parseAdsCsv,
  parseSettlementTxt,
  parseTransactionCsv,
} = require('./financeImport.parser');

const SHOP_SCOPE_TYPE = 'shop';

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasPermission(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission);
}

function assertCanAccessShop(shopId, authContext) {
  if (!authContext || hasPermission(authContext, financePermissions.WRITE)) return;
  if (!authPublic.canAccessScope(authContext, financePermissions.WRITE, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

function isDryRun(value) {
  if (value === false || value === 'false') return false;
  return true;
}

function normalizeContext(context = {}, authContext) {
  assertValidObjectId(context.shopId, 'shopId');
  const normalized = {
    shopId: context.shopId,
    salesChannelCode: String(context.salesChannelCode || '').trim().toUpperCase(),
    marketplaceCode: String(context.marketplaceCode || '').trim().toUpperCase(),
    sourceRef: String(context.sourceRef || 'finance-import').trim(),
    dryRun: isDryRun(context.dryRun),
  };

  if (!normalized.salesChannelCode || !normalized.marketplaceCode) {
    throw appError('Validation failed', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, [
      { message: 'salesChannelCode and marketplaceCode are required' },
    ]);
  }

  assertCanAccessShop(normalized.shopId, authContext);
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

async function importTransactionsFromFile(filePath, rawContext = {}, authContext) {
  return importTransactions(await fs.promises.readFile(filePath, 'utf8'), rawContext, authContext);
}

async function importSettlementsFromFile(filePath, rawContext = {}, authContext) {
  return importSettlements(await fs.promises.readFile(filePath, 'utf8'), rawContext, authContext);
}

async function importAdsFromFile(filePath, rawContext = {}, authContext) {
  return importAds(await fs.promises.readFile(filePath, 'utf8'), rawContext, authContext);
}

module.exports = {
  importAds,
  importAdsFromFile,
  importSettlements,
  importSettlementsFromFile,
  importTransactions,
  importTransactionsFromFile,
};
