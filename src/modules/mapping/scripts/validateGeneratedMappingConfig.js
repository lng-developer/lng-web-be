const fs = require('fs');
const path = require('path');

const requiredFiles = Object.freeze({
  normalizationRules: 'normalization-rules.importable.json',
  skuConfigReview: 'sku-config-rules.review.csv',
  productTypeAliases: 'product-type-alias-clean.json',
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);

  const [headers = [], ...body] = rows;
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateGeneratedConfigDirectory(dir) {
  const files = Object.fromEntries(
    Object.entries(requiredFiles).map(([key, fileName]) => [key, path.join(dir, fileName)]),
  );

  const missingFiles = Object.values(files).filter((filePath) => !fs.existsSync(filePath));
  if (missingFiles.length) {
    return { ok: false, missingFiles, counts: {}, errors: ['REQUIRED_FILE_MISSING'] };
  }

  const normalizationRules = readJson(files.normalizationRules);
  const productTypeAliases = readJson(files.productTypeAliases);
  const skuConfigRows = parseCsv(fs.readFileSync(files.skuConfigReview, 'utf8'));

  const unsafeNormalizationRules = normalizationRules.filter((rule) => (
    !rule.semanticRole
    || !rule.matchValue
    || !['LABEL', 'VALUE', 'LABEL_AND_VALUE'].includes(rule.matchTarget)
    || !['EXACT', 'CONTAINS'].includes(rule.matchType)
  ));
  const unmappedSkuConfigRows = skuConfigRows.filter((row) => !row.currentProductTypeGroupId);
  const unmappedAliasGroups = productTypeAliases.filter((alias) => !alias.productTypeGroupId);

  return {
    ok: unsafeNormalizationRules.length === 0,
    counts: {
      normalizationRules: normalizationRules.length,
      skuConfigRows: skuConfigRows.length,
      skuConfigRowsReady: skuConfigRows.length - unmappedSkuConfigRows.length,
      skuConfigRowsNeedMapping: unmappedSkuConfigRows.length,
      productTypeAliasGroups: productTypeAliases.length,
      productTypeAliasGroupsNeedMapping: unmappedAliasGroups.length,
      unsafeNormalizationRules: unsafeNormalizationRules.length,
    },
    samples: {
      skuConfigRowsNeedMapping: unmappedSkuConfigRows.slice(0, 20).map((row) => ({
        configCode: row.configCode,
        legacyProductTypeGroupName: row.legacyProductTypeGroupName,
        productTypeAliases: row.productTypeAliases,
      })),
      productTypeAliasGroupsNeedMapping: unmappedAliasGroups.slice(0, 20).map((row) => ({
        canonicalProductType: row.canonicalProductType,
        totalCount: row.totalCount,
      })),
    },
    errors: unsafeNormalizationRules.length ? ['UNSAFE_NORMALIZATION_RULE'] : [],
  };
}

if (require.main === module) {
  const dirArg = process.argv.find((arg) => arg.startsWith('--dir='));
  const strict = process.argv.includes('--strict');
  const dir = dirArg ? dirArg.slice('--dir='.length) : 'C:\\data backup portal\\generated-mapping-config';
  const report = validateGeneratedConfigDirectory(dir);

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok || (strict && report.counts.skuConfigRowsNeedMapping > 0)) {
    process.exitCode = 1;
  }
}

module.exports = {
  parseCsv,
  validateGeneratedConfigDirectory,
};
