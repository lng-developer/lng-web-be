const path = require('path');

const catalogPublic = require('../../catalog/public');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const vendorService = require('../services/vendor.service');
const {
  readCsvFile,
  validateVendorImportTemplate,
} = require('./validateVendorImportTemplate');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    if (!key) return args;
    return {
      ...args,
      [key]: valueParts.length > 0 ? valueParts.join('=') : true,
    };
  }, {
    dir: 'C:/data backup portal/vendor-import-template',
    dryRun: 'true',
    skipInvalidRows: 'false',
    maxErrors: '50',
  });
}

function idOf(value) {
  if (!value) return null;
  return String(value.id || value._id || value);
}

function nonEmpty(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

function toInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number.parseInt(String(value), 10);
}

function toOptionalInt(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return Number.parseInt(String(value), 10);
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(String(value).trim());
}

function compactPatch(payload) {
  return Object.entries(payload).reduce((result, [key, value]) => {
    if (value !== undefined) result[key] = value;
    return result;
  }, {});
}

function vendorPayload(row) {
  return compactPatch({
    code: row.code,
    name: row.name,
    providerKey: nonEmpty(row.providerKey),
    fulfillmentType: row.fulfillmentType,
    status: row.status || 'ACTIVE',
    metadata: compactPatch({
      legacyId: nonEmpty(row.legacyId),
      legacyFulfillmentType: nonEmpty(row.legacyFulfillmentType),
    }),
  });
}

function productPayload(row, { vendorId, productTypeGroupId }) {
  return compactPatch({
    vendorId,
    productTypeGroupId,
    code: row.code,
    name: row.name,
    externalProductId: nonEmpty(row.externalProductId),
    productUrl: nonEmpty(row.productUrl),
    imageUrl: nonEmpty(row.imageUrl),
    designTemplateUrl: nonEmpty(row.designTemplateUrl),
    minProductionDays: toOptionalInt(row.minProductionDays),
    maxProductionDays: toOptionalInt(row.maxProductionDays),
    baseCostAmount: toInt(row.baseCostAmount),
    currency: row.currency || 'USD',
    status: row.status || 'ACTIVE',
    metadata: compactPatch({
      legacyId: nonEmpty(row.legacyId),
      legacyVendorId: nonEmpty(row.legacyVendorId),
    }),
  });
}

function shippingPatch(prefix, row) {
  return compactPatch({
    economyAmount: toInt(row[`${prefix}EconomyAmount`]),
    additionalAmount: toInt(row[`${prefix}AdditionalAmount`]),
  });
}

function costCenterPayload(row) {
  return compactPatch({
    code: row.code,
    name: row.name,
    sku: nonEmpty(row.sku),
    lngCode: nonEmpty(row.lngCode),
    vendorSize: nonEmpty(row.vendorSize),
    vendorColor: nonEmpty(row.vendorColor),
    standardSize: nonEmpty(row.standardSize),
    standardColor: nonEmpty(row.standardColor),
    weight: toOptionalNumber(row.weight),
    weightUnit: nonEmpty(row.weightUnit),
    width: toOptionalNumber(row.width),
    length: toOptionalNumber(row.length),
    height: toOptionalNumber(row.height),
    dimensionUnit: nonEmpty(row.dimensionUnit),
    baseCostAmount: toInt(row.baseCostAmount),
    currency: row.currency || 'USD',
    domesticShipping: shippingPatch('domestic', row),
    internationalShipping: shippingPatch('international', row),
    priorityShipping: shippingPatch('priority', row),
    importTaxAmount: toInt(row.importTaxAmount),
    additionalCosts: compactPatch({
      embroideryAmount: toInt(row.embroideryAmount),
      twoSidedPrintAmount: toInt(row.twoSidedPrintAmount),
      twoPositionPrintAmount: toInt(row.twoPositionPrintAmount),
    }),
    status: row.status || 'ACTIVE',
    metadata: compactPatch({
      legacyId: nonEmpty(row.legacyId),
      legacyVendorProductId: nonEmpty(row.legacyVendorProductId),
    }),
  });
}

async function buildProductTypeGroupMap(rows) {
  const codes = [...new Set(rows.map((row) => row.productTypeGroupCode).filter(Boolean))];
  const entries = await Promise.all(codes.map(async (code) => {
    const group = await catalogPublic.findProductTypeGroupByCode(code);
    return [code, group];
  }));
  return new Map(entries);
}

async function validateDatabaseLinks({ vendorProducts, vendorCostCenters }) {
  const errors = [];
  const groupByCode = await buildProductTypeGroupMap(vendorProducts);

  for (const row of vendorProducts) {
    const group = groupByCode.get(row.productTypeGroupCode);
    if (!group || group.status !== 'ACTIVE') {
      errors.push({
        type: 'UNKNOWN_PRODUCT_TYPE_GROUP_CODE',
        key: row.productTypeGroupCode || '',
        productCode: row.code,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    groupByCode,
    vendorCostCenters,
  };
}

async function importVendorTemplateRows({
  vendors = [],
  vendorProducts = [],
  vendorCostCenters = [],
  dryRun = true,
  skipInvalidRows = false,
} = {}) {
  const templateSummary = validateVendorImportTemplate({ vendors, vendorProducts, vendorCostCenters });
  const dbSummary = await validateDatabaseLinks({ vendorProducts, vendorCostCenters });
  const errors = [...templateSummary.errors, ...dbSummary.errors];
  const vendorCodes = new Set(vendors.map((row) => row.code).filter(Boolean));
  const importableProducts = vendorProducts.filter((row) => {
    const group = dbSummary.groupByCode.get(row.productTypeGroupCode);
    return row.vendorCode
      && vendorCodes.has(row.vendorCode)
      && row.productTypeGroupCode
      && group
      && group.status === 'ACTIVE';
  });
  const importableProductLegacyIds = new Set(importableProducts.map((row) => row.legacyId).filter(Boolean));
  const importableProductCodes = new Set(importableProducts.map((row) => row.code).filter(Boolean));
  const importableCostCenters = vendorCostCenters.filter((row) => (
    row.legacyVendorProductId
      ? importableProductLegacyIds.has(row.legacyVendorProductId)
      : importableProductCodes.has(row.vendorProductCode)
  ));

  const summary = {
    dryRun,
    skipInvalidRows,
    valid: errors.length === 0,
    counts: templateSummary.counts,
    created: { vendors: 0, vendorProducts: 0, vendorCostCenters: 0 },
    updated: { vendors: 0, vendorProducts: 0, vendorCostCenters: 0 },
    skipped: {
      vendors: 0,
      vendorProducts: vendorProducts.length - importableProducts.length,
      vendorCostCenters: vendorCostCenters.length - importableCostCenters.length,
    },
    errors,
  };

  if (dryRun || (!summary.valid && !skipInvalidRows)) return summary;

  const vendorIdByCode = new Map();
  for (const row of vendors) {
    const existing = await vendorService.findVendorByCode(row.code, { includeInactive: true });
    if (existing) {
      const updated = await vendorService.updateVendor(idOf(existing), vendorPayload(row));
      vendorIdByCode.set(row.code, idOf(updated) || idOf(existing));
      summary.updated.vendors += 1;
    } else {
      const created = await vendorService.createVendor(vendorPayload(row));
      vendorIdByCode.set(row.code, idOf(created));
      summary.created.vendors += 1;
    }
  }

  const productIdByLegacyId = new Map();
  const productIdByCode = new Map();
  for (const row of importableProducts) {
    const vendorId = vendorIdByCode.get(row.vendorCode);
    const group = dbSummary.groupByCode.get(row.productTypeGroupCode);
    const payload = productPayload(row, {
      vendorId,
      productTypeGroupId: idOf(group),
    });
    const existing = await vendorService.findVendorProductByCode({
      vendorId,
      code: row.code,
    }, { includeInactive: true });
    const product = existing
      ? await vendorService.updateVendorProduct(idOf(existing), payload)
      : await vendorService.createVendorProduct(payload);

    if (existing) summary.updated.vendorProducts += 1;
    else summary.created.vendorProducts += 1;

    productIdByCode.set(row.code, idOf(product));
    if (row.legacyId) productIdByLegacyId.set(row.legacyId, idOf(product));
  }

  for (const row of importableCostCenters) {
    const productId = row.legacyVendorProductId
      ? productIdByLegacyId.get(row.legacyVendorProductId)
      : productIdByCode.get(row.vendorProductCode);
    const existing = await vendorService.findVendorCostCenterByCode({
      vendorProductId: productId,
      code: row.code,
    }, { includeInactive: true });

    if (existing) {
      await vendorService.updateVendorCostCenter(productId, idOf(existing), costCenterPayload(row));
      summary.updated.vendorCostCenters += 1;
    } else {
      await vendorService.createVendorCostCenter(productId, costCenterPayload(row));
      summary.created.vendorCostCenters += 1;
    }
  }

  return summary;
}

function readTemplateDir(dir) {
  return {
    vendors: readCsvFile(path.join(dir, 'vendors.csv')),
    vendorProducts: readCsvFile(path.join(dir, 'vendor_products.csv')),
    vendorCostCenters: readCsvFile(path.join(dir, 'vendor_cost_centers.csv')),
  };
}

async function importVendorTemplateDir({ dir, dryRun = true, skipInvalidRows = false } = {}) {
  return importVendorTemplateRows({
    ...readTemplateDir(dir),
    dryRun,
    skipInvalidRows,
  });
}

async function main() {
  const args = parseArgs();
  const dryRun = String(args.dryRun).toLowerCase() !== 'false';
  const skipInvalidRows = String(args.skipInvalidRows).toLowerCase() === 'true';
  const maxErrors = Number.parseInt(String(args.maxErrors), 10);
  await connectDatabase();
  try {
    const summary = await importVendorTemplateDir({
      dir: path.resolve(args.dir),
      dryRun,
      skipInvalidRows,
    });
    const printable = {
      ...summary,
      errors: Number.isInteger(maxErrors) && maxErrors >= 0
        ? summary.errors.slice(0, maxErrors)
        : summary.errors,
      errorCount: summary.errors.length,
    };
    process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
    if (!summary.valid && !skipInvalidRows) process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  importVendorTemplateDir,
  importVendorTemplateRows,
  parseArgs,
};
