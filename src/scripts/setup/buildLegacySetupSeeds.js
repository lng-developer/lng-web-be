const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  clean,
  ensureDir,
  parseArgs,
  readCsv,
  readJson,
  toBool,
  toCode,
  toInt,
  toMinorUnit,
  uniqueBy,
  upper,
  writeJson,
} = require('./legacySetupUtils');

const DEFAULT_AUDIT_DIR = 'tmp/legacy-setup-audit';
const DEFAULT_OUT_DIR = 'tmp/legacy-setup-audit/normalized';
const DEFAULT_LEGACY_ENV = 'C:/lnd/lng-website/.env';

const configCodeFallbacks = Object.freeze({
  ACP: 'ACRYLIC_PLAQUE',
  ACO: 'ORNAMENT',
  BON: 'ORNAMENT',
  CAP: 'CAP',
  CNL: 'CRYSTAL_NIGHT_LIGHT',
  FV: 'FLOWER_VASE',
  GS: 'GARDEN_SIGN',
  NK: 'NAPKINS',
  RDT: 'RING_DISH_TRAY',
  SCO: 'ORNAMENT',
  STSC: 'ORNAMENT',
  TS: 'T_SHIRT',
  TS1S: 'T_SHIRT',
  TS2S: 'CREWNECK_SWEATSHIRT',
  VS: 'FLOWER_VASE',
});

const inferredGroupCodes = Object.freeze([
  ...Object.values(configCodeFallbacks),
  'HOODIE',
  'ORNAMENT',
]);

const providerKeys = new Set([
  'BEEFUL',
  'GRABINK',
  'MERCHIZE',
  'PRINTWAY',
  'MANGOTEE',
  'MERCHFOX',
  'LENFUL',
  'SS88',
  'LUXURY_PRO',
  'MANGO_P76',
  'ZTB',
  'PGPRINT',
  'ONOSPOD',
  'LNG_GROUP',
  'CUSTOM',
]);

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function providerKeyForVendor(name) {
  const code = toCode(name, 'CUSTOM');
  if (providerKeys.has(code)) return code;
  if (code === 'MANGO_TEE') return 'MANGOTEE';
  if (code === 'LNG_GROUP') return 'LNG_GROUP';
  return 'CUSTOM';
}

function fulfillmentType(value) {
  return String(value || '').trim().toUpperCase() === 'API' ? 'POD' : 'CUSTOM';
}

function productGroupCodeFromText(value) {
  const text = String(value || '').toUpperCase();
  if (!text) return null;
  if (text.includes('NAPKIN')) return 'NAPKINS';
  if (text.includes('SWEATSHIRT') || text.includes('CREWNECK')) return 'CREWNECK_SWEATSHIRT';
  if (text.includes('HOODIE')) return 'HOODIE';
  if (text.includes('T-SHIRT') || text.includes('TSHIRT') || text.includes('TEE')) return 'T_SHIRT';
  if (text.includes('VASE')) return 'FLOWER_VASE';
  if (text.includes('CAP')) return 'CAP';
  if (text.includes('DISH') || text.includes('TRAY')) return 'RING_DISH_TRAY';
  if (text.includes('ORNAMENT')) return 'ORNAMENT';
  if (text.includes('PLAQUE')) return 'ACRYLIC_PLAQUE';
  if (text.includes('NIGHT LIGHT')) return 'CRYSTAL_NIGHT_LIGHT';
  if (text.includes('SIGN')) return 'GARDEN_SIGN';
  return null;
}

function configCodeFromSku(sku) {
  return String(sku || '')
    .toUpperCase()
    .split('-')
    .find((part) => /^[A-Z]{2,}[A-Z0-9]*$/.test(part) && !/^J?\d+$/.test(part)) || null;
}

function productGroupFor({ configCode, productTypeValue, title, sizeValue } = {}) {
  return productGroupCodeFromText(productTypeValue)
    || productGroupCodeFromText(title)
    || configCodeFallbacks[upper(configCode)]
    || productGroupCodeFromText(sizeValue);
}

function defaultFields(labels = []) {
  const wanted = [
    'Custom Name',
    'Enter Name',
    'Custom Text',
    'Custom Date',
    'Select Size',
    'Select Product Type',
    'Color',
    'Select Color',
    'Select Pack',
  ];
  const byLabel = new Set(labels.map((row) => row.label));
  return wanted.filter((label) => byLabel.has(label) || ['Custom Name', 'Select Size'].includes(label))
    .map((label, index) => ({
      key: toCode(label).toLowerCase(),
      label,
      type: label.toUpperCase().includes('SIZE') || label.toUpperCase().includes('COLOR') ? 'OPTION' : 'TEXT',
      required: false,
      source: 'CUSTOMER_INPUT',
      validation: label.toUpperCase().includes('SIZE')
        ? { semanticRole: 'SIZE' }
        : label.toUpperCase().includes('COLOR')
          ? { semanticRole: 'COLOR' }
          : {},
      sortOrder: index + 1,
    }));
}

function buildProductGroups(rows, warnings) {
  const groups = rows.map((row) => ({
    legacyId: row.id || null,
    code: toCode(row.name),
    name: clean(row.name),
    sortOrder: toInt(row.order),
    status: 'ACTIVE',
  })).filter((row) => row.code && row.name);

  inferredGroupCodes.forEach((code) => {
    if (!groups.some((group) => group.code === code)) {
      groups.push({
        legacyId: null,
        code,
        name: code.split('_').map((part) => `${part[0]}${part.slice(1).toLowerCase()}`).join(' '),
        sortOrder: 999,
        status: 'ACTIVE',
      });
      warnings.push({ type: 'INFERRED_PRODUCT_TYPE_GROUP', code });
    }
  });

  return uniqueBy(groups, (row) => row.code);
}

function buildConfigGroupMap({ topCostCombos, topSkus, configRows }) {
  const map = new Map();
  [...topCostCombos, ...topSkus].forEach((row) => {
    const configCode = upper(row.configCode || configCodeFromSku(row.sku));
    if (!configCode || map.has(configCode)) return;
    const groupCode = productGroupFor(row);
    if (groupCode) map.set(configCode, groupCode);
  });
  configRows.forEach((row) => {
    const configCode = upper(row.configCode);
    if (!configCode || map.has(configCode)) return;
    const groupCode = configCodeFallbacks[configCode] || productGroupCodeFromText(row.productTypeKey);
    if (groupCode) map.set(configCode, groupCode);
  });
  return map;
}

function buildTemplates(productGroups, labels) {
  return productGroups.map((group) => ({
    code: `${group.code}_DEFAULT`,
    name: `${group.name} Default`,
    description: 'Generated from legacy setup audit.',
    productTypeGroupCode: group.code,
    requiredFields: defaultFields(labels),
    artworkSlots: [{
      key: 'FRONT',
      label: 'Front',
      type: 'MIXED',
      required: true,
      acceptedFieldKeys: defaultFields(labels).map((field) => field.key),
      outputRole: 'FRONT',
      sortOrder: 1,
    }],
    designAssets: [],
    status: 'ACTIVE',
  }));
}

function buildVendors(rows) {
  return rows.map((row) => ({
    legacyId: row.id || null,
    code: toCode(row.name),
    name: clean(row.name),
    providerKey: providerKeyForVendor(row.name),
    fulfillmentType: fulfillmentType(row.fulfillmentType),
    status: 'ACTIVE',
  })).filter((row) => row.code && row.name);
}

function buildVendorProducts(rows, vendorProductGroupMap, warnings) {
  return rows.map((row) => {
    const productTypeGroupCode = vendorProductGroupMap.get(row.id)
      || productGroupCodeFromText(row.productName);
    if (!productTypeGroupCode) {
      warnings.push({ type: 'VENDOR_PRODUCT_MISSING_PRODUCT_GROUP', legacyId: row.id, productName: row.productName });
      return null;
    }
    return {
      legacyId: row.id,
      legacyVendorId: row.vendorId,
      vendorCode: toCode(row.vendorName),
      productTypeGroupCode,
      code: toCode(row.productId || row.productName),
      name: clean(row.productName) || row.productId,
      externalProductId: clean(row.productId),
      baseCostAmount: 0,
      currency: 'USD',
      status: 'ACTIVE',
    };
  }).filter(Boolean);
}

async function enrichCostCentersFromLegacy({ legacyEnv, vendorProductIds, maxCostCenters, warnings }) {
  const env = readEnv(legacyEnv);
  const uri = env.MONGO_URI || env.MONGODB_URI;
  if (!uri || !vendorProductIds.length) {
    warnings.push({ type: 'LEGACY_COST_CENTER_DB_SKIPPED', reason: uri ? 'no vendor products' : 'missing legacy mongo uri' });
    return [];
  }

  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 15000 }).asPromise();
  try {
    const objectIds = vendorProductIds
      .filter((value) => mongoose.isValidObjectId(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    const rows = await connection.db.collection('vendorcostcenters').find(
      { vendor_product: { $in: objectIds }, status: { $in: ['Active', 'ACTIVE', null] } },
      {
        projection: {
          vendor_product: 1,
          vendor_size: 1,
          vendor_color: 1,
          standard_size: 1,
          standard_color: 1,
          sku: 1,
          base_cost: 1,
          dosmetic: 1,
          international: 1,
          priority: 1,
          additional_costs: 1,
          product_type_design: 1,
          status: 1,
        },
      },
    ).limit(maxCostCenters).toArray();
    return rows;
  } finally {
    await connection.close();
  }
}

function costCenterCode(row) {
  return toCode(row.sku || [
    row.standard_size || row.vendor_size || 'SIZE',
    row.standard_color || row.vendor_color || 'COLOR',
  ].filter(Boolean).join('_'));
}

function buildCostCenters(rows, vendorProductsByLegacyId) {
  return rows.map((row) => {
    const legacyVendorProductId = String(row.vendor_product || row.legacyVendorProductId || '');
    const product = vendorProductsByLegacyId.get(legacyVendorProductId);
    if (!product) return null;
    return {
      legacyId: String(row._id || ''),
      legacyVendorProductId,
      vendorProductCode: product.code,
      vendorCode: product.vendorCode,
      code: costCenterCode(row),
      name: clean([
        row.standard_size || row.vendor_size,
        row.standard_color || row.vendor_color,
      ].filter(Boolean).join(' / ')) || product.name,
      sku: upper(row.sku),
      vendorSize: clean(row.vendor_size),
      vendorColor: clean(row.vendor_color),
      standardSize: clean(row.standard_size || row.vendor_size),
      standardColor: clean(row.standard_color || row.vendor_color),
      baseCostAmount: toMinorUnit(row.base_cost),
      currency: 'USD',
      domesticShipping: {
        economyAmount: toMinorUnit(row.dosmetic?.economy),
        additionalAmount: toMinorUnit(row.dosmetic?.additional),
      },
      internationalShipping: {
        economyAmount: toMinorUnit(row.international?.economy),
        additionalAmount: toMinorUnit(row.international?.additional),
      },
      priorityShipping: {
        economyAmount: toMinorUnit(row.priority?.economy),
        additionalAmount: toMinorUnit(row.priority?.additional),
      },
      status: 'ACTIVE',
    };
  }).filter(Boolean);
}

function buildSkuConfigRules(configRows, configGroupMap) {
  return configRows.map((row, index) => {
    const configCode = upper(row.configCode);
    const productTypeGroupCode = configGroupMap.get(configCode);
    if (!configCode || !productTypeGroupCode) return null;
    return {
      shopName: null,
      salesChannelCode: row.platform ? upper(row.platform) : null,
      marketplaceCode: null,
      configCode,
      productTypeAliases: [],
      platformProductType: clean(row.productTypeKey),
      countryCode: upper(row.country),
      combinationProductTypeKey: clean(row.combinationProductTypeKey),
      sizeKeys: [row.sizeKey].filter(Boolean),
      colorKeys: [row.colorKey].filter(Boolean),
      productTypeKeys: [row.productTypeKey].filter(Boolean),
      productTypeColorKeys: [row.productTypeColorKey].filter(Boolean),
      productTypeSizeKeys: [row.productTypeSizeKey].filter(Boolean),
      combinationKeys: [row.combinationProductTypeKey].filter(Boolean),
      attributeKeyMap: {},
      defaultColor: upper(row.defaultColor),
      isSet: toBool(row.isSet),
      isPack: toBool(row.isPack),
      sizePosition: toInt(row.sizePosition),
      colorPosition: toInt(row.colorPosition),
      productTypeGroupCode,
      internalTemplateCode: `${productTypeGroupCode}_DEFAULT`,
      priority: index + 1,
      status: 'ACTIVE',
    };
  }).filter(Boolean);
}

function buildListings(topAsins, topSkus, configGroupMap, defaultShopName, warnings) {
  const skuByAsin = new Map(topSkus.filter((row) => row.asin).map((row) => [row.asin, row]));
  return topAsins.map((asinRow) => {
    const skuRow = skuByAsin.get(asinRow.asin) || {};
    const sku = asinRow.sampleSku || skuRow.sku;
    const configCode = skuRow.configCode || configCodeFromSku(sku);
    const productTypeGroupCode = configGroupMap.get(upper(configCode)) || productGroupFor({
      configCode,
      title: asinRow.title,
      productTypeValue: skuRow.productTypeValue,
    });
    if (!productTypeGroupCode) {
      warnings.push({ type: 'LISTING_CANDIDATE_MISSING_PRODUCT_GROUP', asin: asinRow.asin, sku });
      return null;
    }
    return {
      shopName: defaultShopName || null,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: upper(asinRow.asin),
      sku: upper(sku),
      title: clean(asinRow.title),
      productTypeGroupCode,
      internalTemplateCode: `${productTypeGroupCode}_DEFAULT`,
      psdStatus: 'MISSING',
      costCenterStatus: 'MISSING',
      orderCount: toInt(asinRow.orders),
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
    };
  }).filter(Boolean);
}

async function buildLegacySetupSeeds({
  auditDir = DEFAULT_AUDIT_DIR,
  outDir = DEFAULT_OUT_DIR,
  legacyEnv = DEFAULT_LEGACY_ENV,
  maxCostCenters = 1000,
  defaultShopName = null,
} = {}) {
  const warnings = [];
  const topSkus = readCsv(path.join(auditDir, 'top_order_skus.csv'));
  const topAsins = readCsv(path.join(auditDir, 'top_asins.csv'));
  const topCostCombos = readCsv(path.join(auditDir, 'top_cost_combos.csv'));
  const configRows = readCsv(path.join(auditDir, 'config_cost_centers.csv'));
  const vendorProductRows = readCsv(path.join(auditDir, 'vendor_products_top.csv'));

  const productTypeGroups = buildProductGroups(readCsv(path.join(auditDir, 'product_type_groups.csv')), warnings);
  const configGroupMap = buildConfigGroupMap({ topCostCombos, topSkus, configRows });
  const vendorProductGroupMap = new Map(topCostCombos
    .filter((row) => row.vendorProductId)
    .map((row) => [row.vendorProductId, productGroupFor(row)])
    .filter(([, groupCode]) => groupCode));
  const vendors = buildVendors(readCsv(path.join(auditDir, 'vendors.csv')));
  const vendorProducts = buildVendorProducts(vendorProductRows, vendorProductGroupMap, warnings);
  const vendorProductIds = uniqueBy(vendorProducts, (row) => row.legacyId).map((row) => row.legacyId);
  const legacyCostCenters = await enrichCostCentersFromLegacy({
    legacyEnv,
    vendorProductIds,
    maxCostCenters: Number(maxCostCenters) || 1000,
    warnings,
  });
  const vendorProductsByLegacyId = new Map(vendorProducts.map((row) => [row.legacyId, row]));
  const vendorCostCenters = buildCostCenters(legacyCostCenters, vendorProductsByLegacyId);
  const customizationLabels = readCsv(path.join(auditDir, 'customization_labels.csv'));
  const internalTemplates = buildTemplates(productTypeGroups, customizationLabels);
  const skuConfigRules = buildSkuConfigRules(configRows, configGroupMap);
  const listingCandidates = buildListings(topAsins, topSkus, configGroupMap, defaultShopName, warnings);

  ensureDir(outDir);
  writeJson(path.join(outDir, 'product-type-groups.seed.json'), productTypeGroups);
  writeJson(path.join(outDir, 'vendors.seed.json'), vendors);
  writeJson(path.join(outDir, 'vendor-products.seed.json'), vendorProducts);
  writeJson(path.join(outDir, 'vendor-cost-centers.seed.json'), vendorCostCenters);
  writeJson(path.join(outDir, 'internal-templates.seed.json'), internalTemplates);
  writeJson(path.join(outDir, 'sku-config-rules.seed.json'), skuConfigRules);
  writeJson(path.join(outDir, 'listing-candidates.seed.json'), listingCandidates);

  const summary = {
    auditDir,
    outDir,
    productTypeGroups: productTypeGroups.length,
    vendors: vendors.length,
    vendorProducts: vendorProducts.length,
    vendorCostCenters: vendorCostCenters.length,
    internalTemplates: internalTemplates.length,
    skuConfigRules: skuConfigRules.length,
    listingCandidates: listingCandidates.length,
    warnings,
  };
  writeJson(path.join(outDir, 'summary.json'), summary);
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    auditDir: DEFAULT_AUDIT_DIR,
    outDir: DEFAULT_OUT_DIR,
    legacyEnv: DEFAULT_LEGACY_ENV,
    maxCostCenters: '1000',
    defaultShopName: null,
  });
  const summary = await buildLegacySetupSeeds(args);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildLegacySetupSeeds,
  configCodeFromSku,
  productGroupFor,
};
