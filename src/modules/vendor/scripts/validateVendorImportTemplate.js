const fs = require('fs');
const path = require('path');

const moneyFields = [
  'baseCostAmount',
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
];
const integerFields = ['minProductionDays', 'maxProductionDays'];
const numberFields = ['weight', 'width', 'length', 'height'];

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function parseCsv(content) {
  const text = String(content || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      row.push(value);
      value = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      if (char === '\r' && next === '\n') index += 1;
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell !== '')) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => headers.reduce((result, header, index) => ({
    ...result,
    [header]: values[index] === undefined ? '' : values[index].trim(),
  }), {}));
}

function readCsvFile(filePath) {
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

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
  });
}

function hasInteger(value) {
  if (value === undefined || value === null || value === '') return true;
  return /^\d+$/.test(String(value).trim());
}

function hasNumber(value) {
  if (value === undefined || value === null || value === '') return true;
  const number = Number(String(value).trim());
  return Number.isFinite(number) && number >= 0;
}

function addFieldErrors({ row, key, fields, predicate, type, errors }) {
  for (const field of fields) {
    if (!predicate(row[field])) {
      errors.push({ type, key, field, value: row[field] });
    }
  }
}

function addDuplicateErrors({ rows, keyFn, type, errors }) {
  const seen = new Set();
  const reported = new Set();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (seen.has(key) && !reported.has(key)) {
      errors.push({ type, key });
      reported.add(key);
    }
    seen.add(key);
  }
}

function isMergeReview(row) {
  return String(row.migrationAction || '').trim().toUpperCase() === 'MERGE_REVIEW';
}

function validateVendorImportTemplate({
  vendors = [], vendorProducts = [], vendorCostCenters = [], allowUnassignedProductTypes = true,
} = {}) {
  const errors = [];
  const importableProducts = vendorProducts.filter((row) => !isMergeReview(row));
  const importableCostCenters = vendorCostCenters.filter((row) => !isMergeReview(row));
  const vendorCodes = new Set(vendors.map((row) => row.code).filter(Boolean));
  const productCodes = new Set(importableProducts.map((row) => row.code).filter(Boolean));
  const productLegacyIds = new Set(importableProducts.map((row) => row.legacyId).filter(Boolean));

  addDuplicateErrors({
    rows: vendors,
    keyFn: (row) => row.code,
    type: 'DUPLICATE_VENDOR_CODE',
    errors,
  });
  addDuplicateErrors({
    rows: importableProducts,
    keyFn: (row) => `${row.vendorCode}:${row.code}`,
    type: 'DUPLICATE_VENDOR_PRODUCT_CODE',
    errors,
  });
  addDuplicateErrors({
    rows: importableCostCenters,
    keyFn: (row) => `${row.vendorProductCode}:${row.code}`,
    type: 'DUPLICATE_COST_CENTER_CODE',
    errors,
  });

  for (const row of importableProducts) {
    if (!row.vendorCode || !vendorCodes.has(row.vendorCode)) {
      errors.push({ type: 'UNKNOWN_VENDOR_CODE', key: row.vendorCode || '', row });
    }
    if (!allowUnassignedProductTypes && !row.productTypeGroupCode) {
      errors.push({ type: 'MISSING_PRODUCT_TYPE_GROUP_CODE', key: row.code || '', row });
    }
    for (const field of moneyFields) {
      if (!hasInteger(row[field])) {
        errors.push({ type: 'INVALID_MONEY_MINOR_UNIT', key: row.code || '', field, value: row[field] });
      }
    }
    addFieldErrors({
      row,
      key: row.code || '',
      fields: integerFields,
      predicate: hasInteger,
      type: 'INVALID_NON_NEGATIVE_INTEGER',
      errors,
    });
  }

  for (const row of importableCostCenters) {
    const hasLegacyProductLink = row.legacyVendorProductId && productLegacyIds.has(row.legacyVendorProductId);
    const hasProductCodeLink = row.vendorProductCode && productCodes.has(row.vendorProductCode);
    if (!hasLegacyProductLink && !hasProductCodeLink) {
      errors.push({ type: 'UNKNOWN_VENDOR_PRODUCT_CODE', key: row.vendorProductCode || '', row });
    }
    for (const field of moneyFields) {
      if (!hasInteger(row[field])) {
        errors.push({ type: 'INVALID_MONEY_MINOR_UNIT', key: row.code || '', field, value: row[field] });
      }
    }
    addFieldErrors({
      row,
      key: row.code || '',
      fields: numberFields,
      predicate: hasNumber,
      type: 'INVALID_NUMBER',
      errors,
    });
  }

  return {
    valid: errors.length === 0,
    counts: {
      vendors: vendors.length,
      vendorProducts: vendorProducts.length,
      vendorCostCenters: vendorCostCenters.length,
    },
    errorCount: errors.length,
    errors,
  };
}

function validateVendorImportTemplateDir(dir, { allowUnassignedProductTypes = true } = {}) {
  return validateVendorImportTemplate({
    vendors: readCsvFile(path.join(dir, 'vendors.csv')),
    vendorProducts: readCsvFile(path.join(dir, 'vendor_products.csv')),
    vendorCostCenters: readCsvFile(path.join(dir, 'vendor_cost_centers.csv')),
    allowUnassignedProductTypes,
  });
}

function main() {
  const args = parseArgs();
  const allowUnassignedProductTypes = String(args.allowUnassignedProductTypes ?? 'true').toLowerCase() !== 'false';
  const summary = validateVendorImportTemplateDir(path.resolve(args.dir), { allowUnassignedProductTypes });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.valid) process.exitCode = 1;
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
  parseArgs,
  parseCsv,
  readCsvFile,
  validateVendorImportTemplate,
  validateVendorImportTemplateDir,
};
