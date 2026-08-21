const fs = require('fs');
const path = require('path');

const {
  buildProductTypeGroupLookup,
  mapLegacyCostCenter,
  mapLegacyProduct,
  mapLegacyVendor,
} = require('./legacyVendorExport.mapper');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    if (!key) return args;
    return {
      ...args,
      [key]: valueParts.length > 0 ? valueParts.join('=') : true,
    };
  }, {
    inputDir: 'C:/data backup portal',
    dryRun: 'true',
  });
}

function readJsonArray(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must be a JSON array`);
  return parsed;
}

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, headers) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
}

function findDuplicates(rows, keyFn) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

function legacySuffix(row) {
  return String(row.legacyId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase() || 'DUP';
}

function dedupeCodeRows(rows, keyFn) {
  const seen = new Set();
  return rows.map((row) => {
    const key = keyFn(row);
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      return row;
    }

    const updated = {
      ...row,
      code: `${row.code}_${legacySuffix(row)}`,
    };
    seen.add(keyFn(updated));
    return updated;
  });
}

function convertLegacyVendorExport({ inputDir, outDir } = {}) {
  const vendors = readJsonArray(path.join(inputDir, 'lng_db.vendors.json'));
  const products = readJsonArray(path.join(inputDir, 'lng_db.vendorproducts.json'));
  const costCenters = readJsonArray(path.join(inputDir, 'lng_db.vendorcostcenters.json'));
  const productTypeGroups = readJsonArray(path.join(inputDir, 'lng_db.producttypegroups.json'));

  const vendorRows = dedupeCodeRows(vendors.map(mapLegacyVendor), (row) => row.code);
  const vendorCodeById = new Map(vendorRows.map((vendor) => [vendor.legacyId, vendor.code]));
  const productTypeGroupCodeByProductId = buildProductTypeGroupLookup(productTypeGroups);

  const productRows = dedupeCodeRows(products.map((product) => mapLegacyProduct(product, {
    vendorCodeById,
    productTypeGroupCodeByProductId,
  })), (row) => `${row.vendorCode}:${row.code}`);
  const productCodeById = new Map(productRows.map((product) => [product.legacyId, product.code]));
  const productMigrationActionById = new Map(productRows.map((product) => [product.legacyId, product.migrationAction]));

  const costCenterRows = dedupeCodeRows(costCenters.map((costCenter) => ({ ...mapLegacyCostCenter(costCenter, {
    productCodeById,
  }), migrationAction: productMigrationActionById.get(String(costCenter.vendor_product?.$oid || costCenter.vendor_product)) ?? 'MERGE_REVIEW' })), (row) => `${row.legacyVendorProductId || row.vendorProductCode}:${row.code}`);

  const summary = {
    inputDir,
    vendors: vendorRows.length,
    vendorProducts: productRows.length,
    vendorCostCenters: costCenterRows.length,
    missingVendorForProducts: productRows.filter((row) => !row.vendorCode).length,
    missingProductTypeGroupForProducts: productRows.filter((row) => !row.productTypeGroupCode).length,
    missingProductForCostCenters: costCenterRows.filter((row) => !row.vendorProductCode).length,
    duplicateVendorCodes: findDuplicates(vendorRows, (row) => row.code),
    duplicateProductCodesByVendor: findDuplicates(productRows, (row) => `${row.vendorCode}:${row.code}`),
    duplicateCostCenterCodesByProduct: findDuplicates(costCenterRows, (row) => `${row.vendorProductCode}:${row.code}`),
    outDir: outDir || null,
  };

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'vendors.csv'), toCsv(vendorRows, [
      'legacyId',
      'code',
      'name',
      'providerKey',
      'fulfillmentType',
      'legacyFulfillmentType',
      'status',
    ]));
    fs.writeFileSync(path.join(outDir, 'vendor_products.csv'), toCsv(productRows, [
      'legacyId',
      'legacyVendorId',
      'vendorCode',
      'code',
      'name',
      'externalProductId',
      'productTypeGroupCode',
      'migrationAction',
      'productUrl',
      'imageUrl',
      'designTemplateUrl',
      'minProductionDays',
      'maxProductionDays',
      'baseCostAmount',
      'currency',
      'status',
    ]));
    fs.writeFileSync(path.join(outDir, 'vendor_cost_centers.csv'), toCsv(costCenterRows, [
      'legacyId',
      'legacyVendorProductId',
      'vendorProductCode',
      'code',
      'name',
      'vendorSize',
      'vendorColor',
      'standardSize',
      'standardColor',
      'migrationAction',
      'printMethod',
      'weight',
      'weightUnit',
      'width',
      'length',
      'height',
      'dimensionUnit',
      'sku',
      'lngCode',
      'baseCostAmount',
      'currency',
      'domesticEconomyAmount',
      'domesticAdditionalAmount',
      'internationalEconomyAmount',
      'internationalAdditionalAmount',
      'priorityEconomyAmount',
      'priorityAdditionalAmount',
      'importTaxAmount',
      'embroideryAmount',
      'twoSidedPrintAmount',
      'twoPositionPrintAmount',
      'status',
    ]));
  }

  return summary;
}

function main() {
  const args = parseArgs();
  const dryRun = String(args.dryRun).toLowerCase() !== 'false';
  const outDir = dryRun ? null : path.resolve(args.outDir || path.join(args.inputDir, 'vendor-import-template'));
  const summary = convertLegacyVendorExport({
    inputDir: path.resolve(args.inputDir),
    outDir,
  });
  process.stdout.write(`${JSON.stringify({ ...summary, dryRun }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  convertLegacyVendorExport,
  dedupeCodeRows,
  parseArgs,
  toCsv,
};
