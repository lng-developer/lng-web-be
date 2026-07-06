const AppError = require('../../../../../shared/errors/appError');
const errorCodes = require('../../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../../shared/constants/httpStatus');
const logger = require('../../../../../shared/utils/logger');
const orderPublic = require('../../../../order/public');
const customizationPublic = require('../../../../customization/public');
const jobRepository = require('../../repositories/externalOrderImportJob.repository');
const sourceFileRepository = require('../../repositories/externalOrderImportSourceFile.repository');
const rawRecordRepository = require('../../repositories/externalOrderRawRecord.repository');
const issueRepository = require('../../repositories/externalOrderImportIssue.repository');
const {
  externalOrderImportSources,
  externalOrderImportSourceTypes,
} = require('../../constants/externalOrderImportSources');
const {
  externalOrderImportJobStatuses,
  externalOrderRawRecordImportStatuses,
  externalOrderRawRecordNormalizeStatuses,
} = require('../../constants/externalOrderImportStatuses');
const {
  externalOrderImportIssueSeverities,
  externalOrderImportIssueTypes,
} = require('../../constants/externalOrderImportIssueTypes');
const {
  calculateFileHash,
  calculateRecordHash,
} = require('../../helpers/stableHash');
const {
  mapAmazonOrderReportRowsToExternalOrderDtos,
} = require('./amazonOrderReport.mapper');
const {
  mapEtsySoldOrderItemRowsToExternalOrderDtos,
} = require('./etsySoldOrderItems.mapper');
const { parseUploadedOrderReport } = require('./manualExcel.parser');

function requireValue(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new AppError(`${field} is required`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, { field });
  }
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function getRowValue(row, key) {
  const sourceKey = Object.keys(row || {}).find((candidate) => candidate === key || candidate.trim() === key);
  const value = sourceKey === undefined ? undefined : row[sourceKey];
  return value === undefined || value === null ? '' : String(value).trim();
}

function getFirstRowValue(row, keys = []) {
  return keys.map((key) => getRowValue(row, key)).find(Boolean) || '';
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function isBlankRow(row = {}) {
  return Object.values(row).every((value) => getRowValue({ value }, 'value') === '');
}

function isScientificNotation(value) {
  return /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(String(value || '').trim());
}

function isIntegerString(value) {
  return /^\d+$/.test(String(value || '').trim());
}

const amazonUsefulItemFields = [
  'asin',
  'sku',
  'product-name',
  'quantity-purchased',
  'number-of-items',
  'item-price',
  'item-tax',
  'shipping-price',
  'shipping-tax',
  'gift-wrap-price',
  'gift-wrap-tax',
  'item-promotion-discount',
  'ship-promotion-discount',
  'customized-url',
  'customized-page',
  'item-extensions-data',
];

const etsyUsefulItemFields = [
  'Item Name',
  'Quantity',
  'Price',
  'Order Shipping',
  'Order Sales Tax',
  'Item Total',
  'Currency',
  'Transaction ID',
  'Listing ID',
  'Variations',
  'SKU',
];

const amazonOrderReportConfig = {
  salesChannelCode: 'AMAZON',
  usefulItemFields: amazonUsefulItemFields,
  requiredFields: [
    { keys: ['order-id', 'amazon-order-id'], label: 'order-id' },
    { keys: ['order-item-id'], label: 'order-item-id' },
  ],
  getExternalOrderId: (row) => getFirstRowValue(row, ['order-id', 'amazon-order-id']),
  getExternalItemId: (row) => getRowValue(row, 'order-item-id'),
  getSku: (row) => getRowValue(row, 'sku'),
  getAsin: (row) => getRowValue(row, 'asin'),
  mapRowsToDtos: mapAmazonOrderReportRowsToExternalOrderDtos,
};

const etsySoldOrderItemsConfig = {
  salesChannelCode: 'ETSY',
  usefulItemFields: etsyUsefulItemFields,
  requiredFields: [
    { key: 'Order ID', label: 'Order ID' },
    { key: 'Transaction ID', label: 'Transaction ID' },
  ],
  getExternalOrderId: (row) => getRowValue(row, 'Order ID'),
  getExternalItemId: (row) => getRowValue(row, 'Transaction ID'),
  getSku: (row) => getRowValue(row, 'SKU'),
  getAsin: () => '',
  mapRowsToDtos: mapEtsySoldOrderItemRowsToExternalOrderDtos,
};

async function createIssue(payload) {
  await issueRepository.create({
    source: externalOrderImportSources.MANUAL_EXCEL,
    severity: externalOrderImportIssueSeverities.ERROR,
    ...payload,
  });
}

function scoreItemRow(row, config) {
  return config.usefulItemFields.reduce((score, field) => (
    getRowValue(row, field) ? score + 1 : score
  ), 0);
}

function getBestRowEntry(entries = [], config = amazonOrderReportConfig) {
  return entries.reduce((best, entry) => (
    !best || scoreItemRow(entry.row, config) > scoreItemRow(best.row, config) ? entry : best
  ), null);
}

function validateRequiredRowFields(row, config) {
  const missingFields = [];
  config.requiredFields.forEach(({ key, keys, label }) => {
    const candidates = keys || [key];
    if (!getFirstRowValue(row, candidates)) missingFields.push(label);
  });
  return missingFields;
}

async function createRawRecord({ jobId, row, rowNumber, config }) {
  return rawRecordRepository.create({
    importJobId: jobId,
    source: externalOrderImportSources.MANUAL_EXCEL,
    rowNumber,
    externalOrderId: config.getExternalOrderId(row) || null,
    externalItemId: config.getExternalItemId(row) || null,
    asin: config.getAsin(row) || null,
    sku: config.getSku(row) || null,
    rawRecord: row,
    rawRecordHash: calculateRecordHash(row),
  });
}

function attachRawRecordIds(dto, validRows, config = amazonOrderReportConfig) {
  const rowsForOrder = validRows.filter(({ row }) => config.getExternalOrderId(row) === dto.externalOrderId);
  const rawRecordIds = rowsForOrder.map(({ rawRecord }) => toId(rawRecord));
  const rowsByExternalItemId = new Map();

  rowsForOrder.forEach((entry) => {
    const externalItemId = config.getExternalItemId(entry.row);
    if (!rowsByExternalItemId.has(externalItemId)) {
      rowsByExternalItemId.set(externalItemId, []);
    }
    rowsByExternalItemId.get(externalItemId).push(entry);
  });

  return {
    ...dto,
    rawRecordIds,
    items: dto.items.map((item) => {
      const rowEntries = rowsByExternalItemId.get(String(item.externalItemId)) || [];
      const bestRowEntry = getBestRowEntry(rowEntries, config);
      const itemRawRecordIds = rowEntries.map(({ rawRecord }) => toId(rawRecord));
      const rawRecordId = bestRowEntry ? toId(bestRowEntry.rawRecord) : undefined;
      return {
        ...item,
        rawRecordId,
        rawRecordIds: itemRawRecordIds,
      };
    }),
  };
}

function getDtoItemByExternalItemId(dto, externalItemId) {
  return (dto.items || []).find((item) => String(item.externalItemId) === String(externalItemId));
}

function getCustomizationMismatch(dto, itemResult, processResult) {
  const customerInputs = processResult
    && processResult.payload
    && processResult.payload.parsedData
    && processResult.payload.parsedData.amazonCustomization
    && processResult.payload.parsedData.amazonCustomization.customerInputs;

  if (!customerInputs) return null;

  const mismatches = [];
  if (customerInputs.orderId && String(customerInputs.orderId) !== String(dto.externalOrderId)) {
    mismatches.push({
      field: 'orderId',
      expected: String(dto.externalOrderId),
      actual: String(customerInputs.orderId),
    });
  }

  if (customerInputs.orderItemId && String(customerInputs.orderItemId) !== String(itemResult.externalItemId)) {
    if (
      customerInputs.orderId
      && String(customerInputs.orderId) === String(dto.externalOrderId)
      && isScientificNotation(itemResult.externalItemId)
      && isIntegerString(customerInputs.orderItemId)
    ) {
      return {
        canonicalExternalItemId: String(customerInputs.orderItemId),
      };
    }

    mismatches.push({
      field: 'orderItemId',
      expected: String(itemResult.externalItemId),
      actual: String(customerInputs.orderItemId),
    });
  }

  if (mismatches.length === 0) return null;

  return {
    message: `Customization JSON mismatch: ${mismatches.map((entry) => `${entry.field} expected ${entry.expected} got ${entry.actual}`).join('; ')}`,
    details: {
      payloadId: processResult.payloadId || null,
      mismatches,
    },
  };
}

function getCustomizationAsin(processResult) {
  const asin = processResult
    && processResult.payload
    && processResult.payload.parsedData
    && processResult.payload.parsedData.amazonCustomization
    && processResult.payload.parsedData.amazonCustomization.customerInputs
    && processResult.payload.parsedData.amazonCustomization.customerInputs.asin;

  return asin ? String(asin).trim() : '';
}

async function markImportedItemRows({ dto, itemResult, importResult }) {
  const dtoItem = getDtoItemByExternalItemId(dto, itemResult.externalItemId);
  const rawRecordIds = dtoItem && dtoItem.rawRecordIds && dtoItem.rawRecordIds.length > 0
    ? dtoItem.rawRecordIds
    : [itemResult.rawRecordId].filter(Boolean);

  await Promise.all(rawRecordIds.map((rawRecordId) => (
    rawRecordRepository.updateImportResult(rawRecordId, {
      importStatus: externalOrderRawRecordImportStatuses.IMPORTED,
      orderId: importResult.orderId,
      orderItemId: itemResult.orderItemId,
    })
  )));
}

async function markRowsImportResult(rowsForOrder, patch) {
  await Promise.all(rowsForOrder.map(({ rawRecord }) => (
    rawRecordRepository.updateImportResult(toId(rawRecord), patch)
  )));
}

async function validateImportedAddress({ dto, importResult }) {
  try {
    await orderPublic.validateAddress(importResult.orderId);
    return 0;
  } catch (error) {
    await createIssue({
      importJobId: dto.importJobId,
      externalOrderId: dto.externalOrderId,
      issueType: externalOrderImportIssueTypes.ADDRESS_VALIDATION_FAILED,
      errorCode: error.code || externalOrderImportIssueTypes.ADDRESS_VALIDATION_FAILED,
      errorMessage: getErrorMessage(error),
    });
    return 1;
  }
}

async function autoMarkFulfillmentReady({ dto, importResult, orderIssueCount }) {
  if (orderIssueCount > 0) {
    return;
  }

  await Promise.all((importResult.itemResults || []).map(async (itemResult) => {
    try {
      await orderPublic.markFulfillmentReady(itemResult.orderItemId);
    } catch (error) {
      logger.warn('Auto fulfillment-ready skipped', {
        orderId: importResult.orderId,
        orderItemId: itemResult.orderItemId,
        externalOrderId: dto.externalOrderId,
        externalItemId: itemResult.externalItemId,
        error,
      });
    }
  }));
}

async function processCustomizationForItem(orderItemId) {
  await customizationPublic.parseForOrderItem(orderItemId);
  const downloadResult = await customizationPublic.downloadAssetsForOrderItem(orderItemId, {
    retryFailed: false,
    maxBytes: 10 * 1024 * 1024,
    timeoutMs: 15000,
    idleTimeoutMs: 10000,
    maxRedirects: 3,
  });

  if ((downloadResult.downloadedCount || 0) === 0) {
    return { downloadResult };
  }

  await customizationPublic.inspectDownloadedZipForOrderItem(orderItemId, {
    maxEntries: 50,
    maxTotalUncompressedBytes: 50 * 1024 * 1024,
    maxSingleEntryUncompressedBytes: 20 * 1024 * 1024,
  });
  const extractResult = await customizationPublic.extractZipImagesForOrderItem(orderItemId, {
    maxImages: 10,
    maxSingleImageBytes: 10 * 1024 * 1024,
    maxTotalImageBytes: 50 * 1024 * 1024,
  });

  return { downloadResult, extractResult };
}

async function createCustomizationPayloads({
  dto,
  importResult,
  itemRows,
  shopId,
  config,
}) {
  let issueCount = 0;

  for (const itemResult of importResult.itemResults || []) {
    if (!itemResult.hasCustomization) {
      continue;
    }

    try {
      await customizationPublic.createPendingPayload({
        orderItemId: itemResult.orderItemId,
        orderId: importResult.orderId,
        shopId,
        source: externalOrderImportSources.MANUAL_EXCEL,
        rawRecordId: itemResult.rawRecordId,
        rawCustomization: itemResult.customization,
      });
      const processResult = await processCustomizationForItem(itemResult.orderItemId);
      const mismatch = getCustomizationMismatch(dto, itemResult, processResult && processResult.extractResult);
      const customizationAsin = getCustomizationAsin(processResult && processResult.extractResult);

      if (customizationAsin && !itemResult.asin && typeof orderPublic.updateItemAsin === 'function') {
        await orderPublic.updateItemAsin(itemResult.orderItemId, customizationAsin);
        itemResult.asin = customizationAsin;
      }

      if (mismatch && mismatch.canonicalExternalItemId) {
        await orderPublic.updateItemExternalItemId(itemResult.orderItemId, mismatch.canonicalExternalItemId);
        itemResult.externalItemId = mismatch.canonicalExternalItemId;
      } else if (mismatch) {
        issueCount += 1;
        await customizationPublic.markNeedsReview(mismatch.details.payloadId, mismatch.message);
        const rowEntry = getBestRowEntry(itemRows.filter(({ row }) => (
          config.getExternalItemId(row) === String(itemResult.externalItemId)
        )), config);

        await createIssue({
          importJobId: dto.importJobId,
          rawRecordId: rowEntry ? toId(rowEntry.rawRecord) : null,
          externalOrderId: dto.externalOrderId,
          externalItemId: itemResult.externalItemId,
          rowNumber: rowEntry ? rowEntry.rowNumber : null,
          issueType: externalOrderImportIssueTypes.CUSTOMIZATION_MISMATCH,
          errorCode: externalOrderImportIssueTypes.CUSTOMIZATION_MISMATCH,
          errorMessage: mismatch.message,
          details: mismatch.details,
        });
      }
    } catch (error) {
      issueCount += 1;
      const rowEntry = getBestRowEntry(itemRows.filter(({ row }) => (
        config.getExternalItemId(row) === String(itemResult.externalItemId)
      )), config);

      await createIssue({
        importJobId: dto.importJobId,
        rawRecordId: rowEntry ? toId(rowEntry.rawRecord) : null,
        externalOrderId: dto.externalOrderId,
        externalItemId: itemResult.externalItemId,
        rowNumber: rowEntry ? rowEntry.rowNumber : null,
        issueType: externalOrderImportIssueTypes.CUSTOMIZATION_CREATE_FAILED,
        errorCode: error.code || errorCodes.APP_ERROR,
        errorMessage: getErrorMessage(error),
      });
    }
  }

  return issueCount;
}

async function importManualFileReport({
  buffer,
  originalFilename,
  mimeType,
  shopId,
  shopConnectionId,
  marketplaceCode,
  externalAccountId,
  triggeredBy,
}, config) {
  requireValue(buffer, 'buffer');
  requireValue(originalFilename, 'originalFilename');
  requireValue(marketplaceCode, 'marketplaceCode');
  requireValue(shopId, 'shopId');

  const job = await jobRepository.create({
    source: externalOrderImportSources.MANUAL_EXCEL,
    sourceType: externalOrderImportSourceTypes.FILE,
    shopId,
    shopConnectionId,
    salesChannelCode: config.salesChannelCode,
    marketplaceCode,
    externalAccountId,
    status: externalOrderImportJobStatuses.PARSING,
    startedAt: new Date(),
    triggeredBy,
  });
  const jobId = toId(job);
  let totalRecords = 0;
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let issuesCount = 0;

  try {
    const sourceFile = await sourceFileRepository.create({
      importJobId: jobId,
      source: externalOrderImportSources.MANUAL_EXCEL,
      originalFilename,
      mimeType,
      fileHash: calculateFileHash(buffer),
      uploadedBy: triggeredBy,
    });
    await sourceFileRepository.linkToJob(toId(sourceFile), jobId);
    await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.PARSING, { sourceFileId: toId(sourceFile) });

    const parsed = parseUploadedOrderReport(buffer, { originalFilename, mimeType });
    totalRecords = parsed.rowCount;
    const validRows = [];

    for (let index = 0; index < parsed.rows.length; index += 1) {
      const rowNumber = index + 1;
      const row = parsed.rows[index];
      if (isBlankRow(row)) {
        continue;
      }
      const rawRecord = await createRawRecord({
        jobId,
        row,
        rowNumber,
        config,
      });
      const missingFields = validateRequiredRowFields(row, config);

      if (missingFields.length > 0) {
        failedCount += 1;
        issuesCount += 1;
        await rawRecordRepository.updateNormalizeResult(toId(rawRecord), {
          normalizeStatus: externalOrderRawRecordNormalizeStatuses.FAILED,
          errorCode: externalOrderImportIssueTypes.MISSING_REQUIRED_FIELD,
          errorMessage: `Missing required field: ${missingFields.join(', ')}`,
        });
        await createIssue({
          importJobId: jobId,
          rawRecordId: toId(rawRecord),
          externalOrderId: config.getExternalOrderId(row) || null,
          externalItemId: config.getExternalItemId(row) || null,
          rowNumber,
          issueType: externalOrderImportIssueTypes.MISSING_REQUIRED_FIELD,
          errorCode: externalOrderImportIssueTypes.MISSING_REQUIRED_FIELD,
          errorMessage: `Missing required field: ${missingFields.join(', ')}`,
          details: { missingFields },
        });
        continue;
      }

      await rawRecordRepository.updateNormalizeResult(toId(rawRecord), {
        normalizeStatus: externalOrderRawRecordNormalizeStatuses.NORMALIZED,
      });
      validRows.push({ row, rowNumber, rawRecord });
    }

    await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.IMPORTING);

    const dtos = config.mapRowsToDtos(
      validRows.map(({ row }) => row),
      {
        shopId,
        shopConnectionId,
        marketplaceCode,
        externalAccountId,
        sourceFileId: toId(sourceFile),
        importJobId: jobId,
      },
    ).map((dto) => attachRawRecordIds({ ...dto, importJobId: jobId }, validRows, config));

    for (const dto of dtos) {
      const rowsForOrder = validRows.filter(({ row }) => config.getExternalOrderId(row) === dto.externalOrderId);

      try {
        const importResult = await orderPublic.importExternalOrder(dto);
        const itemResults = importResult.itemResults || [];

        for (const itemResult of itemResults) {
          await markImportedItemRows({ dto, itemResult, importResult });
        }

        importedCount += rowsForOrder.length;
        const orderIssueCount = await validateImportedAddress({ dto, importResult })
          + await createCustomizationPayloads({
          dto,
          importResult,
          itemRows: rowsForOrder,
          shopId,
          config,
        });
        issuesCount += orderIssueCount;
        await autoMarkFulfillmentReady({ dto, importResult, orderIssueCount });
      } catch (error) {
        failedCount += rowsForOrder.length;
        issuesCount += 1;
        await markRowsImportResult(rowsForOrder, {
          importStatus: externalOrderRawRecordImportStatuses.FAILED,
          errorCode: error.code || errorCodes.APP_ERROR,
          errorMessage: getErrorMessage(error),
        });
        await createIssue({
          importJobId: jobId,
          externalOrderId: dto.externalOrderId,
          issueType: externalOrderImportIssueTypes.ORDER_IMPORT_FAILED,
          errorCode: error.code || errorCodes.APP_ERROR,
          errorMessage: getErrorMessage(error),
          details: { rawRecordIds: rowsForOrder.map(({ rawRecord }) => toId(rawRecord)) },
        });
      }
    }

    const status = failedCount > 0 || issuesCount > 0
      ? externalOrderImportJobStatuses.PARTIAL_FAILED
      : externalOrderImportJobStatuses.COMPLETED;
    await jobRepository.updateCounters(jobId, {
      totalRecords,
      parsedCount: validRows.length,
      importedCount,
      skippedCount,
      failedCount,
      finishedAt: new Date(),
    });
    await jobRepository.updateStatus(jobId, status, { finishedAt: new Date() });

    return {
      jobId,
      status,
      totalRecords,
      importedCount,
      skippedCount,
      failedCount,
      issuesCount,
    };
  } catch (error) {
    await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.FAILED, {
      errorCode: error.code || errorCodes.APP_ERROR,
      errorMessage: getErrorMessage(error),
      finishedAt: new Date(),
    });
    throw error;
  }
}

async function importManualExcelOrderReport(payload) {
  return importManualFileReport(payload, amazonOrderReportConfig);
}

async function importEtsySoldOrderItems(payload) {
  return importManualFileReport(payload, etsySoldOrderItemsConfig);
}

module.exports = {
  attachRawRecordIds,
  getBestRowEntry,
  getRowValue,
  importEtsySoldOrderItems,
  importManualExcelOrderReport,
};
