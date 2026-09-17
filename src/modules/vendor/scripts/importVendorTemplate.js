const path = require('path');

const catalogPublic = require('../../catalog/public');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const vendorService = require('../services/vendor.service');
const costCenterRepository = require('../repositories/vendorCostCenter.repository');
const productRepository = require('../repositories/vendorProduct.repository');
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
    allowUnassignedProductTypes: 'true',
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

function isMergeReview(row) {
  return String(row.migrationAction || '').trim().toUpperCase() === 'MERGE_REVIEW';
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
    printMethod: nonEmpty(row.printMethod),
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

async function validateDatabaseLinks({ vendorProducts, vendorCostCenters, allowUnassignedProductTypes = true }) {
  const errors = [];
  const groupByCode = allowUnassignedProductTypes ? new Map() : await buildProductTypeGroupMap(vendorProducts);

  for (const row of vendorProducts) {
    if (allowUnassignedProductTypes || isMergeReview(row)) continue;
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

function buildVendorMigrationReviewRows({ vendors = [], vendorProducts = [], vendorCostCenters = [] } = {}) {
  const vendorNameByCode = new Map(vendors.map((row) => [row.code, row.name]));
  const reviewVariantCountByProductId = vendorCostCenters.reduce((counts, row) => {
    if (!isMergeReview(row) || !row.legacyVendorProductId) return counts;
    counts.set(row.legacyVendorProductId, (counts.get(row.legacyVendorProductId) || 0) + 1);
    return counts;
  }, new Map());
  return vendorProducts
    .filter((row) => isMergeReview(row) && row.legacyId)
    .map((row) => ({
      legacyProductId: row.legacyId,
      legacyVendorId: nonEmpty(row.legacyVendorId) || null,
      vendorCode: nonEmpty(row.vendorCode) || null,
      vendorName: vendorNameByCode.get(row.vendorCode) || null,
      code: row.code,
      name: row.name,
      externalProductId: nonEmpty(row.externalProductId) || null,
      variantCount: reviewVariantCountByProductId.get(row.legacyId) || 0,
      source: row,
    }));
}

async function importVendorTemplateRows({
  vendors = [],
  vendorProducts = [],
  vendorCostCenters = [],
  dryRun = true,
  skipInvalidRows = false,
  allowUnassignedProductTypes = true,
  authContext,
} = {}) {
  const templateSummary = validateVendorImportTemplate({
    vendors, vendorProducts, vendorCostCenters, allowUnassignedProductTypes,
  });
  const dbSummary = await validateDatabaseLinks({ vendorProducts, vendorCostCenters, allowUnassignedProductTypes });
  const errors = [...templateSummary.errors, ...dbSummary.errors];
  const vendorCodes = new Set(vendors.map((row) => row.code).filter(Boolean));
  const importableProducts = vendorProducts.filter((row) => {
    const group = dbSummary.groupByCode.get(row.productTypeGroupCode);
    return row.vendorCode
      && vendorCodes.has(row.vendorCode)
      && (allowUnassignedProductTypes || (row.productTypeGroupCode && group && group.status === 'ACTIVE'))
      && !isMergeReview(row);
  });
  const importableProductLegacyIds = new Set(importableProducts.map((row) => row.legacyId).filter(Boolean));
  const importableProductCodes = new Set(importableProducts.map((row) => row.code).filter(Boolean));
  const importableCostCenters = vendorCostCenters.filter((row) => !isMergeReview(row) && (
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

  const importAuthContext = { ...authContext, import: true };

  const reviewRows = buildVendorMigrationReviewRows({ vendors, vendorProducts, vendorCostCenters });
  if (reviewRows.length) await vendorService.stageVendorMigrationReviews(reviewRows);

  const vendorIdByCode = new Map();
  for (const row of vendors) {
    if (isMergeReview(row)) continue;
    const existingByLegacyId = row.legacyId
      ? await vendorService.findVendorByLegacyId(row.legacyId)
      : null;
    const existing = existingByLegacyId
      || await vendorService.findVendorByCode(row.code, { includeInactive: true });
    if (existing) {
      const updated = await vendorService.updateVendor(idOf(existing), vendorPayload(row), importAuthContext);
      vendorIdByCode.set(row.code, idOf(updated) || idOf(existing));
      summary.updated.vendors += 1;
    } else {
      const created = await vendorService.createVendor(vendorPayload(row), importAuthContext);
      vendorIdByCode.set(row.code, idOf(created));
      summary.created.vendors += 1;
    }
  }

  const productIdByLegacyId = new Map();
  const productIdByCode = new Map();
  const vendorIdByProductId = new Map();
  const canBulkCreateProducts = (await productRepository.countAll()) === 0;
  if (canBulkCreateProducts) {
    const products = await productRepository.createMany(importableProducts.map((row) => {
      const group = dbSummary.groupByCode.get(row.productTypeGroupCode);
      return productPayload(row, {
        vendorId: vendorIdByCode.get(row.vendorCode),
        productTypeGroupId: allowUnassignedProductTypes ? null : idOf(group),
      });
    }));
    products.forEach((product, index) => {
      const row = importableProducts[index];
      const productId = idOf(product);
      productIdByCode.set(row.code, productId);
      if (row.legacyId) productIdByLegacyId.set(row.legacyId, productId);
      vendorIdByProductId.set(String(productId), vendorIdByCode.get(row.vendorCode));
    });
    summary.created.vendorProducts += products.length;
  } else for (const row of importableProducts) {
    const vendorId = vendorIdByCode.get(row.vendorCode);
    const group = dbSummary.groupByCode.get(row.productTypeGroupCode);
    const payload = productPayload(row, {
      vendorId,
      productTypeGroupId: allowUnassignedProductTypes ? null : idOf(group),
    });
    const existing = row.legacyId
      ? await vendorService.findVendorProductByLegacyId(row.legacyId)
      : await vendorService.findVendorProductByCode({ vendorId, code: row.code }, { includeInactive: true });
    const product = existing
      ? await vendorService.updateVendorProduct(idOf(existing), payload, importAuthContext)
      : await vendorService.createVendorProduct(payload, importAuthContext);

    if (existing) summary.updated.vendorProducts += 1;
    else summary.created.vendorProducts += 1;

    const productId = idOf(product) || idOf(existing);
    productIdByCode.set(row.code, productId);
    if (row.legacyId) productIdByLegacyId.set(row.legacyId, productId);
    vendorIdByProductId.set(String(productId), vendorId);
  }

  const canBulkCreateCostCenters = (await costCenterRepository.countAll()) === 0;
  if (canBulkCreateCostCenters) {
    const batchSize = 500;
    for (let index = 0; index < importableCostCenters.length; index += batchSize) {
      const batch = importableCostCenters.slice(index, index + batchSize).map((row) => {
        const productId = row.legacyVendorProductId
          ? productIdByLegacyId.get(row.legacyVendorProductId)
          : productIdByCode.get(row.vendorProductCode);
        return {
          ...costCenterPayload(row),
          vendorProductId: productId,
          vendorId: vendorIdByProductId.get(String(productId)),
        };
      });
      await costCenterRepository.createMany(batch);
      summary.created.vendorCostCenters += batch.length;
    }
    return summary;
  }

  for (const row of importableCostCenters) {
    const productId = row.legacyVendorProductId
      ? productIdByLegacyId.get(row.legacyVendorProductId)
      : productIdByCode.get(row.vendorProductCode);
    const existing = row.legacyId
      ? await vendorService.findVendorCostCenterByLegacyId(row.legacyId)
      : await vendorService.findVendorCostCenterByCode({ vendorProductId: productId, code: row.code }, { includeInactive: true });

    if (existing) {
      await vendorService.updateVendorCostCenter(productId, idOf(existing), costCenterPayload(row), importAuthContext);
      summary.updated.vendorCostCenters += 1;
    } else {
      await vendorService.createVendorCostCenter(productId, costCenterPayload(row), importAuthContext);
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

async function importVendorTemplateDir({ dir, dryRun = true, skipInvalidRows = false, allowUnassignedProductTypes = true } = {}) {
  return importVendorTemplateRows({
    ...readTemplateDir(dir),
    dryRun,
    skipInvalidRows,
    allowUnassignedProductTypes,
  });
}

async function main() {
  const args = parseArgs();
  const dryRun = String(args.dryRun).toLowerCase() !== 'false';
  const skipInvalidRows = String(args.skipInvalidRows).toLowerCase() === 'true';
  const allowUnassignedProductTypes = String(args.allowUnassignedProductTypes ?? 'true').toLowerCase() !== 'false';
  const maxErrors = Number.parseInt(String(args.maxErrors), 10);
  await connectDatabase();
  try {
    const summary = await importVendorTemplateDir({
      dir: path.resolve(args.dir),
      dryRun,
      skipInvalidRows,
      allowUnassignedProductTypes,
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
  buildVendorMigrationReviewRows,
  importVendorTemplateDir,
  importVendorTemplateRows,
  parseArgs,
  readTemplateDir,
};
