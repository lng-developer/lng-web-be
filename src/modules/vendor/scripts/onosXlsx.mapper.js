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
    vendorCode: 'ONOS',
    vendorName: 'ONOS',
    productCode: '',
    productTypeGroupCode: '',
  });
}

function value(row, index) {
  return row[index] === undefined || row[index] === null ? '' : String(row[index]).trim();
}

function numberOrBlank(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  const number = Number(raw);
  return Number.isFinite(number) ? number : '';
}

function compactOnosRow(row) {
  return {
    variantSku: value(row, 0),
    size: value(row, 1),
    color: value(row, 2),
    weight: value(row, 4),
    width: value(row, 5),
    length: value(row, 6),
    height: value(row, 7),
    cod: value(row, 8),
    comboExpressUs: value(row, 9),
    comboTiktok: value(row, 10),
    importTax: value(row, 11),
  };
}

function sparseOnosRow(row, headerIndex) {
  return {
    variantSku: value(row, headerIndex),
    size: value(row, headerIndex + 1),
    color: value(row, headerIndex + 2),
    weight: value(row, headerIndex + 3),
    width: value(row, headerIndex + 4),
    length: value(row, headerIndex + 5),
    height: value(row, headerIndex + 6),
    cod: value(row, headerIndex + 7),
    comboExpressUs: value(row, headerIndex + 8),
    comboTiktok: value(row, headerIndex + 9),
    importTax: value(row, headerIndex + 10),
  };
}

function mapOnosRowsToTemplate(rows = [], {
  vendorCode,
  productCode,
  productTypeGroupCode,
} = {}) {
  const vendorProducts = [];
  const vendorCostCenters = [];
  let currentProduct = null;
  let headerIndex = -1;

  for (const row of rows) {
    const variantHeaderIndex = row.findIndex((cell) => String(cell || '').trim() === 'VARIANT_SKU');
    if (variantHeaderIndex >= 0) {
      const title = value(row, 0);
      const code = productCode || toCode(title);
      currentProduct = { title, code };
      headerIndex = variantHeaderIndex;
      if (!vendorProducts.some((product) => product.code === code)) {
        vendorProducts.push({
          vendorCode,
          code,
          name: title,
          externalProductId: code,
          productTypeGroupCode,
          productUrl: '',
          imageUrl: '',
          designTemplateUrl: '',
          minProductionDays: '',
          maxProductionDays: '',
          baseCostAmount: 0,
          currency: 'USD',
          status: 'ACTIVE',
        });
      }
      continue;
    }

    if (!currentProduct || (!value(row, 0) && !value(row, headerIndex))) continue;
    const raw = value(row, headerIndex) ? sparseOnosRow(row, headerIndex) : compactOnosRow(row);
    if (!raw.variantSku) continue;
    const baseCostAmount = moneyToMinorUnits(raw.comboExpressUs || raw.cod);

    vendorCostCenters.push({
      vendorProductCode: currentProduct.code,
      code: toCode(raw.variantSku),
      name: [raw.size, raw.color].filter(Boolean).join(' / ') || raw.variantSku,
      sku: raw.variantSku,
      vendorSize: raw.size,
      vendorColor: raw.color,
      standardSize: raw.size,
      standardColor: raw.color,
      weight: numberOrBlank(raw.weight),
      weightUnit: raw.weight ? 'OZ' : '',
      width: numberOrBlank(raw.width),
      length: numberOrBlank(raw.length),
      height: numberOrBlank(raw.height),
      dimensionUnit: raw.width || raw.length || raw.height ? 'IN' : '',
      baseCostAmount,
      currency: 'USD',
      domesticEconomyAmount: baseCostAmount,
      domesticAdditionalAmount: '',
      internationalEconomyAmount: '',
      internationalAdditionalAmount: '',
      priorityEconomyAmount: moneyToMinorUnits(raw.comboTiktok),
      priorityAdditionalAmount: '',
      importTaxAmount: moneyToMinorUnits(raw.importTax),
      status: 'ACTIVE',
    });
  }

  return { vendors: [], vendorProducts, vendorCostCenters };
}

async function convertOnosXlsx({ input, outDir, vendorCode, vendorName, productCode, productTypeGroupCode }) {
  const sheets = await readXlsxRows(input);
  const rows = sheets.flatMap((sheet) => sheet.rows);
  const template = mapOnosRowsToTemplate(rows, {
    vendorCode,
    productCode,
    productTypeGroupCode,
  });
  template.vendors = [{
    code: vendorCode,
    name: vendorName,
    providerKey: 'ONOSPOD',
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
  const summary = await convertOnosXlsx({
    input: path.resolve(args.input),
    outDir: path.resolve(args.outDir),
    vendorCode: args.vendorCode,
    vendorName: args.vendorName,
    productCode: args.productCode,
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
  convertOnosXlsx,
  mapOnosRowsToTemplate,
};
