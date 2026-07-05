const fs = require('fs');
const path = require('path');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const MappingNormalizationRule = require('../models/mappingNormalizationRule.model');
const MappingSkuConfigRule = require('../models/mappingSkuConfigRule.model');
const MappingSkuNormalizeRule = require('../models/mappingSkuNormalizeRule.model');
const { parseCsv } = require('./validateGeneratedMappingConfig');

const defaultDir = 'C:\\data backup portal\\generated-mapping-config';

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeNullable(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function splitAliases(value) {
  return String(value || '')
    .split('|')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function pickPayloadFields(payload, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(payload, field))
      .map((field) => [field, normalizeNullable(payload[field])]),
  );
}

function buildImportPayloads(dir = defaultDir) {
  const normalizationRules = readJson(path.join(dir, 'normalization-rules.importable.json'))
    .map((rule) => pickPayloadFields(rule, [
      'shopId',
      'salesChannelCode',
      'marketplaceCode',
      'productTypeGroupId',
      'semanticRole',
      'matchTarget',
      'matchType',
      'matchValue',
      'normalizedValue',
      'priority',
      'status',
    ]));

  const skuNormalizeRules = readJson(path.join(dir, 'sku-normalize-rules.suggested.json'))
    .map((rule) => ({
      ...pickPayloadFields(rule, [
        'shopId',
        'salesChannelCode',
        'marketplaceCode',
        'configCode',
        'patternType',
        'segmentIndex',
        'segmentRole',
        'outputAction',
        'replacementValue',
        'priority',
        'status',
      ]),
      appliesWhenValues: rule.appliesWhenValues || [],
    }));

  const skuConfigCsvPath = path.join(dir, 'sku-config-rules.importable.csv');
  const skuConfigRows = fs.existsSync(skuConfigCsvPath)
    ? parseCsv(fs.readFileSync(skuConfigCsvPath, 'utf8'))
    : [];
  const skuConfigRules = skuConfigRows
    .filter((row) => row.currentProductTypeGroupId)
    .map((row) => ({
      shopId: normalizeNullable(row.shopId),
      salesChannelCode: normalizeNullable(row.salesChannelCode),
      marketplaceCode: normalizeNullable(row.marketplaceCode),
      configCode: row.configCode,
      productTypeAliases: splitAliases(row.productTypeAliases),
      platformProductType: normalizeNullable(row.platformProductType),
      countryCode: normalizeNullable(row.countryCode),
      combinationProductTypeKey: normalizeNullable(row.combinationProductTypeKey),
      isSet: String(row.isSet).toLowerCase() === 'true',
      isPack: String(row.isPack).toLowerCase() === 'true',
      sizePosition: Number(row.sizePosition || 0),
      colorPosition: Number(row.colorPosition || 0),
      productTypeGroupId: row.currentProductTypeGroupId,
      internalTemplateId: normalizeNullable(row.internalTemplateId),
      priority: Number(row.priority || 100),
      status: row.status || 'ACTIVE',
    }));

  return {
    normalizationRules,
    skuConfigRules,
    skuNormalizeRules,
  };
}

function upsertNormalizationRule(rule) {
  return MappingNormalizationRule.findOneAndUpdate(
    {
      shopId: rule.shopId,
      salesChannelCode: rule.salesChannelCode,
      marketplaceCode: rule.marketplaceCode,
      productTypeGroupId: rule.productTypeGroupId,
      semanticRole: rule.semanticRole,
      matchTarget: rule.matchTarget,
      matchType: rule.matchType,
      matchValue: rule.matchValue,
    },
    { $set: rule },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

function upsertSkuNormalizeRule(rule) {
  return MappingSkuNormalizeRule.findOneAndUpdate(
    {
      shopId: rule.shopId,
      salesChannelCode: rule.salesChannelCode,
      marketplaceCode: rule.marketplaceCode,
      configCode: rule.configCode,
      patternType: rule.patternType,
      segmentIndex: rule.segmentIndex,
      segmentRole: rule.segmentRole,
      outputAction: rule.outputAction,
    },
    { $set: rule },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

function upsertSkuConfigRule(rule) {
  return MappingSkuConfigRule.findOneAndUpdate(
    {
      shopId: rule.shopId,
      salesChannelCode: rule.salesChannelCode,
      marketplaceCode: rule.marketplaceCode,
      configCode: rule.configCode,
      productTypeGroupId: rule.productTypeGroupId,
      countryCode: rule.countryCode,
    },
    { $set: rule },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function importGeneratedMappingConfig({ dir = defaultDir, dryRun = true } = {}) {
  const payloads = buildImportPayloads(dir);
  const summary = {
    dir,
    dryRun,
    normalizationRules: payloads.normalizationRules.length,
    skuNormalizeRules: payloads.skuNormalizeRules.length,
    skuConfigRules: payloads.skuConfigRules.length,
    written: {
      normalizationRules: 0,
      skuNormalizeRules: 0,
      skuConfigRules: 0,
    },
  };

  if (dryRun) return summary;

  for (const rule of payloads.normalizationRules) {
    await upsertNormalizationRule(rule);
    summary.written.normalizationRules += 1;
  }
  for (const rule of payloads.skuNormalizeRules) {
    await upsertSkuNormalizeRule(rule);
    summary.written.skuNormalizeRules += 1;
  }
  for (const rule of payloads.skuConfigRules) {
    await upsertSkuConfigRule(rule);
    summary.written.skuConfigRules += 1;
  }

  return summary;
}

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    if (!key) return args;
    return { ...args, [key]: value.length ? value.join('=') : true };
  }, { dir: defaultDir, dryRun: 'true' });
}

async function main() {
  const args = parseArgs();
  const dryRun = String(args.dryRun).toLowerCase() !== 'false';

  if (!dryRun) await connectDatabase();
  try {
    const summary = await importGeneratedMappingConfig({ dir: args.dir, dryRun });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    if (!dryRun) await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildImportPayloads,
  importGeneratedMappingConfig,
  parseArgs,
};
