const { connectDatabase, disconnectDatabase } = require('../../../../config/database');
const orderPublic = require('../../../order/public');
const jobRepository = require('../repositories/externalOrderImportJob.repository');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const {
  mapAmazonOrderReportRowsToExternalOrderDtos,
} = require('../sources/manualExcel/amazonOrderReport.mapper');
const {
  attachRawRecordIds,
} = require('../sources/manualExcel/manualExcelImport.service');

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function parseRepairArgs(argv = process.argv.slice(2)) {
  const args = argv.reduce((result, arg) => {
    const [key, ...valueParts] = String(arg).replace(/^--/, '').split('=');
    result[key] = valueParts.length > 0 ? valueParts.join('=') : 'true';
    return result;
  }, {});

  if (!args.externalOrderId) {
    throw new Error('--externalOrderId is required');
  }

  return {
    externalOrderId: args.externalOrderId,
    dryRun: args.dryRun !== 'false',
  };
}

function summarizeDto(dto) {
  return {
    externalOrderId: dto.externalOrderId,
    rawRecordIds: dto.rawRecordIds,
    items: (dto.items || []).map((item) => ({
      externalItemId: item.externalItemId,
      sku: item.sku,
      title: item.title,
      price: item.price,
      customizationRawSummary: item.customizationRawSummary,
      rawRecordId: item.rawRecordId,
      rawRecordIds: item.rawRecordIds,
    })),
  };
}

async function buildRepairDto(externalOrderId) {
  const rawRecords = await rawRecordRepository.listByExternalOrderId(externalOrderId);

  if (rawRecords.length === 0) {
    throw new Error(`No raw records found for externalOrderId ${externalOrderId}`);
  }

  const job = await jobRepository.findById(rawRecords[0].importJobId);

  if (!job) {
    throw new Error(`Import job not found for raw record ${toId(rawRecords[0])}`);
  }

  const dtos = mapAmazonOrderReportRowsToExternalOrderDtos(
    rawRecords.map((rawRecord) => rawRecord.rawRecord),
    {
      shopId: toId(job.shopId),
      shopConnectionId: toId(job.shopConnectionId),
      marketplaceCode: job.marketplaceCode,
      externalAccountId: job.externalAccountId,
      importJobId: toId(job),
      sourceFileId: toId(job.sourceFileId),
    },
  );

  if (dtos.length !== 1) {
    throw new Error(`Expected one DTO for externalOrderId ${externalOrderId}, got ${dtos.length}`);
  }

  return attachRawRecordIds(
    { ...dtos[0], importJobId: toId(job) },
    rawRecords.map((rawRecord) => ({
      row: rawRecord.rawRecord,
      rowNumber: rawRecord.rowNumber,
      rawRecord,
    })),
  );
}

async function repairDuplicateOrderItemImports({ externalOrderId, dryRun = true }) {
  const dto = await buildRepairDto(externalOrderId);
  const result = {
    dryRun,
    externalOrderId,
    rawRecordCount: dto.rawRecordIds.length,
    itemCount: dto.items.length,
    dto,
    mergedPreview: summarizeDto(dto),
    importResult: null,
  };

  if (!dryRun) {
    result.importResult = await orderPublic.importExternalOrder(dto);
  }

  return result;
}

async function main() {
  const args = parseRepairArgs();
  await connectDatabase();

  try {
    const result = await repairDuplicateOrderItemImports(args);
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      externalOrderId: result.externalOrderId,
      rawRecordCount: result.rawRecordCount,
      itemCount: result.itemCount,
      before: result.mergedPreview,
      after: result.importResult,
    }, null, 2));
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = {
  buildRepairDto,
  parseRepairArgs,
  repairDuplicateOrderItemImports,
  summarizeDto,
};
