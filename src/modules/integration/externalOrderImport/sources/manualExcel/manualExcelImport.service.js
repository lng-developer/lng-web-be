const AppError = require('../../../../../shared/errors/appError');
const errorCodes = require('../../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../../shared/constants/httpStatus');
const orderPublic = require('../../../../order/public');
const customizationPublic = require('../../../../customization/public');
const mappingPublic = require('../../../../mapping/public');
const jobRepository = require('../../repositories/externalOrderImportJob.repository');
const sourceFileRepository = require('../../repositories/externalOrderImportSourceFile.repository');
const rawRecordRepository = require('../../repositories/externalOrderRawRecord.repository');
const issueRepository = require('../../repositories/externalOrderImportIssue.repository');
const postImportMappingQueue = require('../../services/postImportMappingQueue.service');
const customizationAssetQueue = require('../../services/customizationAssetQueue.service');
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

async function createRawRecordsFromRows({ jobId, parsed, config }) {
  const validRows = [];
  let failedCount = 0;
  let issuesCount = 0;
  const payloads = [];
  const issuePayloads = [];

  for (let index = 0; index < parsed.rows.length; index += 1) {
    const rowNumber = index + 1;
    const row = parsed.rows[index];
    if (isBlankRow(row)) continue;

    const missingFields = validateRequiredRowFields(row, config);
    const failed = missingFields.length > 0;
    if (failed) {
      failedCount += 1;
      issuesCount += 1;
    }

    payloads.push({
      importJobId: jobId,
      source: externalOrderImportSources.MANUAL_EXCEL,
      rowNumber,
      externalOrderId: config.getExternalOrderId(row) || null,
      externalItemId: config.getExternalItemId(row) || null,
      asin: config.getAsin(row) || null,
      sku: config.getSku(row) || null,
      rawRecord: row,
      rawRecordHash: calculateRecordHash(row),
      normalizeStatus: failed
        ? externalOrderRawRecordNormalizeStatuses.FAILED
        : externalOrderRawRecordNormalizeStatuses.NORMALIZED,
      ...(failed && {
        errorCode: externalOrderImportIssueTypes.MISSING_REQUIRED_FIELD,
        errorMessage: `Missing required field: ${missingFields.join(', ')}`,
      }),
    });

    if (failed) {
      issuePayloads.push({
        rowNumber,
        row,
        missingFields,
      });
    }
  }

  const rawRecords = await rawRecordRepository.createMany(payloads);
  const rawRecordByRowNumber = new Map(rawRecords.map((record) => [record.rowNumber, record]));

  await Promise.all(issuePayloads.map(({ rowNumber, row, missingFields }) => createIssue({
    importJobId: jobId,
    rawRecordId: toId(rawRecordByRowNumber.get(rowNumber)),
    externalOrderId: config.getExternalOrderId(row) || null,
    externalItemId: config.getExternalItemId(row) || null,
    rowNumber,
    issueType: externalOrderImportIssueTypes.MISSING_REQUIRED_FIELD,
    errorCode: externalOrderImportIssueTypes.MISSING_REQUIRED_FIELD,
    errorMessage: `Missing required field: ${missingFields.join(', ')}`,
    details: { missingFields },
  })));

  for (const rawRecord of rawRecords) {
    if (rawRecord.normalizeStatus === externalOrderRawRecordNormalizeStatuses.NORMALIZED) {
      validRows.push({ row: rawRecord.rawRecord, rowNumber: rawRecord.rowNumber, rawRecord });
    }
  }

  return { failedCount, issuesCount, validRows };
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
    if (typeof orderPublic.ensureOpenOrderCase === 'function') {
      await orderPublic.ensureOpenOrderCase({
        orderId: importResult.orderId,
        caseType: 'ADDRESS',
        severity: 'HIGH',
        title: 'Address validation failed',
        description: getErrorMessage(error),
      }, { system: true });
    }
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

async function enqueuePostImportMappingForImportedItems({ dto, importResult }) {
  let queuedCount = 0;
  for (const itemResult of importResult.itemResults || []) {
    if (itemResult.hasCustomization) continue;

    const dtoItem = getDtoItemByExternalItemId(dto, itemResult.externalItemId);
    const rawRecordIds = dtoItem && dtoItem.rawRecordIds && dtoItem.rawRecordIds.length > 0
      ? dtoItem.rawRecordIds
      : [itemResult.rawRecordId].filter(Boolean);
    const result = await postImportMappingQueue.enqueuePostImportMappingJob({
      importJobId: dto.importJobId,
      rawRecordId: itemResult.rawRecordId || rawRecordIds[0] || null,
      rawRecordIds,
      orderId: importResult.orderId,
      orderItemId: itemResult.orderItemId,
      externalOrderId: dto.externalOrderId,
      externalItemId: itemResult.externalItemId,
      asin: itemResult.asin || null,
      source: 'EXTERNAL_ORDER_IMPORT',
    });
    if (result.queued) queuedCount += 1;
  }

  return queuedCount;
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
      const dtoItem = getDtoItemByExternalItemId(dto, itemResult.externalItemId);
      const rawRecordIds = dtoItem && dtoItem.rawRecordIds && dtoItem.rawRecordIds.length > 0
        ? dtoItem.rawRecordIds
        : [itemResult.rawRecordId].filter(Boolean);
      const queueResult = await customizationAssetQueue.enqueueCustomizationAssetJob({
        importJobId: dto.importJobId,
        rawRecordId: itemResult.rawRecordId || rawRecordIds[0] || null,
        rawRecordIds,
        orderId: importResult.orderId,
        orderItemId: itemResult.orderItemId,
        externalOrderId: dto.externalOrderId,
        externalItemId: itemResult.externalItemId,
        asin: itemResult.asin || null,
        source: 'EXTERNAL_ORDER_IMPORT',
      });

      if (!queueResult.queued) {
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
          errorCode: queueResult.errorCode || externalOrderImportIssueTypes.CUSTOMIZATION_CREATE_FAILED,
          errorMessage: queueResult.errorMessage || 'Customization asset job could not be queued',
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

async function normalizeDtoSkus(dto) {
  if (typeof mappingPublic.normalizeSkuForContext !== 'function') return dto;

  const items = await Promise.all((dto.items || []).map(async (item) => {
    if (!item.sku) return item;
    const result = await mappingPublic.normalizeSkuForContext(item.sku, {
      shopId: toId(dto.shopId),
      salesChannelCode: dto.salesChannelCode,
      marketplaceCode: dto.marketplaceCode,
    });
    if (!result.appliedRuleIds.length || result.canonicalSku === result.originalSku) return item;
    return {
      ...item,
      sku: result.canonicalSku,
      externalData: {
        ...(item.externalData || {}),
        originalSku: result.originalSku,
        skuNormalization: result,
      },
    };
  }));

  return { ...dto, items };
}

async function processImportDtos({ dtos, validRows, config, shopId, jobId }) {
  let importedCount = 0;
  let failedCount = 0;
  let issuesCount = 0;
  let postImportQueuedCount = 0;

  for (const dto of dtos) {
    const rowsForOrder = validRows.filter(({ row }) => config.getExternalOrderId(row) === dto.externalOrderId);

    try {
      const importDto = await normalizeDtoSkus(dto);
      const importResult = await orderPublic.importExternalOrder(importDto);
      const itemResults = importResult.itemResults || [];

      for (const itemResult of itemResults) {
        await markImportedItemRows({ dto, itemResult, importResult });
      }

      importedCount += rowsForOrder.length;
      const readinessIssueCount = await createCustomizationPayloads({
          dto,
          importResult,
          itemRows: rowsForOrder,
          shopId,
          config,
        })
        + await validateImportedAddress({ dto, importResult });
      postImportQueuedCount += await enqueuePostImportMappingForImportedItems({ dto, importResult });
      issuesCount += readinessIssueCount;
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

  return {
    importedCount,
    failedCount,
    issuesCount,
    postImportQueuedCount,
  };
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
}, config, { processImmediately = true } = {}) {
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
  let postImportQueuedCount = 0;

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
    const rawPrepare = await createRawRecordsFromRows({ jobId, parsed, config });
    failedCount = rawPrepare.failedCount;
    issuesCount = rawPrepare.issuesCount;
    const validRows = rawPrepare.validRows;

    if (!processImmediately) {
      const status = validRows.length > 0
        ? externalOrderImportJobStatuses.PENDING
        : externalOrderImportJobStatuses.PARTIAL_FAILED;
      await jobRepository.updateCounters(jobId, {
        totalRecords,
        parsedCount: validRows.length,
        importedCount: 0,
        skippedCount,
        failedCount,
      });
      await jobRepository.updateStatus(jobId, status, {
        finishedAt: status === externalOrderImportJobStatuses.PARTIAL_FAILED ? new Date() : null,
      });
      return {
        jobId,
        status,
        totalRecords,
        parsedCount: validRows.length,
        importedCount: 0,
        skippedCount,
        failedCount,
        issuesCount,
        postImportQueuedCount: 0,
      };
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

    const importProcess = await processImportDtos({ dtos, validRows, config, shopId, jobId });
    importedCount += importProcess.importedCount;
    failedCount += importProcess.failedCount;
    issuesCount += importProcess.issuesCount;
    postImportQueuedCount += importProcess.postImportQueuedCount;

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
      postImportQueuedCount,
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

async function prepareQueuedManualFileReport({
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
    status: externalOrderImportJobStatuses.PENDING,
    triggeredBy,
  });
  const jobId = toId(job);
  const sourceFile = await sourceFileRepository.create({
    importJobId: jobId,
    source: externalOrderImportSources.MANUAL_EXCEL,
    originalFilename,
    mimeType,
    fileHash: calculateFileHash(buffer),
    contentBase64: buffer.toString('base64'),
    uploadedBy: triggeredBy,
  });

  await sourceFileRepository.linkToJob(toId(sourceFile), jobId);
  await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.PENDING, {
    sourceFileId: toId(sourceFile),
    finishedAt: null,
  });

  return {
    jobId,
    status: externalOrderImportJobStatuses.PENDING,
    totalRecords: 0,
    parsedCount: 0,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    issuesCount: 0,
    postImportQueuedCount: 0,
  };
}

async function importManualExcelOrderReport(payload) {
  return importManualFileReport(payload, amazonOrderReportConfig);
}

async function prepareManualExcelOrderReport(payload) {
  return importManualFileReport(payload, amazonOrderReportConfig, { processImmediately: false });
}

async function prepareQueuedManualExcelOrderReport(payload) {
  return prepareQueuedManualFileReport(payload, amazonOrderReportConfig);
}

async function importEtsySoldOrderItems(payload) {
  return importManualFileReport(payload, etsySoldOrderItemsConfig);
}

async function prepareEtsySoldOrderItems(payload) {
  return importManualFileReport(payload, etsySoldOrderItemsConfig, { processImmediately: false });
}

async function prepareQueuedEtsySoldOrderItems(payload) {
  return prepareQueuedManualFileReport(payload, etsySoldOrderItemsConfig);
}

function getConfigForJob(job) {
  return job.salesChannelCode === etsySoldOrderItemsConfig.salesChannelCode
    ? etsySoldOrderItemsConfig
    : amazonOrderReportConfig;
}

async function prepareRawRecordsForJob(job) {
  const jobId = toId(job);
  const existingRawRecords = await rawRecordRepository.listAllByJob(jobId);
  if (existingRawRecords.length > 0) {
    return {
      totalRecords: existingRawRecords.length,
      parsedCount: existingRawRecords.filter((record) => (
        record.normalizeStatus === externalOrderRawRecordNormalizeStatuses.NORMALIZED
      )).length,
      failedCount: existingRawRecords.filter((record) => (
        record.normalizeStatus === externalOrderRawRecordNormalizeStatuses.FAILED
      )).length,
      issuesCount: 0,
    };
  }

  if (!job.sourceFileId) {
    return {
      totalRecords: 0,
      parsedCount: 0,
      failedCount: 0,
      issuesCount: 0,
    };
  }
  const sourceFile = await sourceFileRepository.findByIdWithContent(job.sourceFileId);
  if (!sourceFile || !sourceFile.contentBase64) {
    throw new AppError('Import source file content is missing', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  await jobRepository.updateStatus(jobId, externalOrderImportJobStatuses.PARSING, {
    startedAt: new Date(),
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
  });

  const config = getConfigForJob(job);
  const buffer = Buffer.from(sourceFile.contentBase64, 'base64');
  const parsed = parseUploadedOrderReport(buffer, {
    originalFilename: sourceFile.originalFilename,
    mimeType: sourceFile.mimeType,
  });
  const rawPrepare = await createRawRecordsFromRows({ jobId, parsed, config });

  await jobRepository.updateCounters(jobId, {
    totalRecords: parsed.rowCount,
    parsedCount: rawPrepare.validRows.length,
    importedCount: 0,
    skippedCount: 0,
    failedCount: rawPrepare.failedCount,
  });

  return {
    totalRecords: parsed.rowCount,
    parsedCount: rawPrepare.validRows.length,
    failedCount: rawPrepare.failedCount,
    issuesCount: rawPrepare.issuesCount,
  };
}

async function retryManualImportJob(job) {
  const jobId = toId(job);
  const config = getConfigForJob(job);
  const rawRecords = await rawRecordRepository.listAllByJob(jobId);
  const retryRows = rawRecords
    .filter((rawRecord) => (
      rawRecord.normalizeStatus === externalOrderRawRecordNormalizeStatuses.NORMALIZED
      && [
        externalOrderRawRecordImportStatuses.PENDING,
        externalOrderRawRecordImportStatuses.FAILED,
      ].includes(rawRecord.importStatus)
    ))
    .map((rawRecord) => ({
      row: rawRecord.rawRecord,
      rowNumber: rawRecord.rowNumber,
      rawRecord,
    }));

  if (!retryRows.length) {
    return {
      replayedRawRecords: 0,
      importedCount: 0,
      failedCount: 0,
      issuesCount: 0,
      postImportQueuedCount: 0,
    };
  }

  const dtos = config.mapRowsToDtos(
    retryRows.map(({ row }) => row),
    {
      shopId: toId(job.shopId),
      shopConnectionId: toId(job.shopConnectionId),
      marketplaceCode: job.marketplaceCode,
      externalAccountId: job.externalAccountId,
      sourceFileId: toId(job.sourceFileId),
      importJobId: jobId,
    },
  ).map((dto) => attachRawRecordIds({ ...dto, importJobId: jobId }, retryRows, config));

  const result = await processImportDtos({
    dtos,
    validRows: retryRows,
    config,
    shopId: toId(job.shopId),
    jobId,
  });

  return {
    replayedRawRecords: result.importedCount,
    ...result,
  };
}

module.exports = {
  attachRawRecordIds,
  getBestRowEntry,
  getRowValue,
  importEtsySoldOrderItems,
  importManualExcelOrderReport,
  prepareQueuedEtsySoldOrderItems,
  prepareQueuedManualExcelOrderReport,
  prepareRawRecordsForJob,
  prepareEtsySoldOrderItems,
  prepareManualExcelOrderReport,
  retryManualImportJob,
};
