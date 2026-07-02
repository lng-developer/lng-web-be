const path = require('path');
const { moneyToMinorUnits, toCode } = require('./legacyVendorExport.mapper');
const { writeVendorTemplateCsv } = require('./vendorTemplateCsv');
const { readXlsxRows } = require('./xlsxWorksheetReader');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    if (!key) return args;
    return { ...args, [key]: valueParts.length > 0 ? valueParts.join('=') : true };
  }, {
    vendorCode: 'MERCHIZE',
    vendorName: 'Merchize',
    productTypeGroupCode: '',
  });
}

function numberOrBlank(value) {
  if (value === undefined || value === null || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}

function rowValue(row, key) {
  return row[key] === undefined || row[key] === null ? '' : String(row[key]).trim();
}

function rowsToObjects(rows = []) {
  const headerIndex = rows.findIndex((row) => row.includes('Product Title') && row.includes('SKU variant'));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((header) => String(header || '').trim());
  return rows.slice(headerIndex + 1)
    .map((row) => headers.reduce((result, header, index) => {
      if (header) result[header] = row[index] === undefined ? '' : row[index];
      return result;
    }, {}))
    .filter((row) => rowValue(row, 'SKU product') && rowValue(row, 'SKU variant'));
}

function mapMerchizeRowsToTemplate(rows = [], { vendorCode, productTypeGroupCode } = {}) {
  const productByCode = new Map();
  const vendorCostCenters = [];

  for (const row of rows) {
    const productCode = toCode(rowValue(row, 'SKU product'));
    const sku = rowValue(row, 'SKU variant');
    if (!productCode || !sku) continue;

    if (!productByCode.has(productCode)) {
      productByCode.set(productCode, {
        vendorCode,
        code: productCode,
        name: rowValue(row, 'Product Title'),
        externalProductId: rowValue(row, 'SKU product'),
        productTypeGroupCode,
        productUrl: rowValue(row, 'Link'),
        imageUrl: '',
        designTemplateUrl: rowValue(row, 'Design Template'),
        minProductionDays: numberOrBlank(rowValue(row, 'Min production time')),
        maxProductionDays: numberOrBlank(rowValue(row, 'Max production time')),
        baseCostAmount: moneyToMinorUnits(rowValue(row, 'Tier 1 (0 - 999)')),
        currency: 'USD',
        status: 'ACTIVE',
      });
    }

    vendorCostCenters.push({
      vendorProductCode: productCode,
      code: toCode(sku),
      name: [rowValue(row, 'SIZES'), rowValue(row, 'SKU variant')].filter(Boolean).join(' / '),
      sku,
      vendorSize: rowValue(row, 'SIZES'),
      vendorColor: '',
      standardSize: rowValue(row, 'SIZES'),
      standardColor: '',
      baseCostAmount: moneyToMinorUnits(rowValue(row, 'Tier 1 (0 - 999)')),
      currency: 'USD',
      domesticEconomyAmount: moneyToMinorUnits(rowValue(row, 'US shipping fee (1st item)')),
      domesticAdditionalAmount: moneyToMinorUnits(rowValue(row, 'US additional shipping fee')),
      internationalEconomyAmount: moneyToMinorUnits(rowValue(row, 'ROW shipping fee (1st item)')),
      internationalAdditionalAmount: moneyToMinorUnits(rowValue(row, 'ROW additional shipping fee')),
      priorityEconomyAmount: '',
      priorityAdditionalAmount: '',
      importTaxAmount: moneyToMinorUnits(rowValue(row, 'US import Tax/item')),
      status: 'ACTIVE',
    });
  }

  return {
    vendors: [],
    vendorProducts: [...productByCode.values()],
    vendorCostCenters,
  };
}

async function convertMerchizeXlsx({ input, outDir, vendorCode, vendorName, productTypeGroupCode }) {
  const sheets = await readXlsxRows(input);
  const rows = sheets.flatMap((sheet) => rowsToObjects(sheet.rows));
  const template = mapMerchizeRowsToTemplate(rows, { vendorCode, productTypeGroupCode });
  template.vendors = [{
    code: vendorCode,
    name: vendorName,
    providerKey: 'MERCHIZE',
    fulfillmentType: 'POD',
    status: 'ACTIVE',
  }];
  writeVendorTemplateCsv({ outDir, ...template });
  return {
    outDir,
    vendors: template.vendors.length,
    vendorProducts: template.vendorProducts.length,
    vendorCostCenters: template.vendorCostCenters.length,
  };
}

async function main() {
  const args = parseArgs();
  const summary = await convertMerchizeXlsx({
    input: path.resolve(args.input),
    outDir: path.resolve(args.outDir),
    vendorCode: args.vendorCode,
    vendorName: args.vendorName,
    productTypeGroupCode: args.productTypeGroupCode,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  convertMerchizeXlsx,
  mapMerchizeRowsToTemplate,
  rowsToObjects,
};
