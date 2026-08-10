const path = require('path');

const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const ProductTypeGroup = require('../../../src/modules/catalog/models/productTypeGroup.model');
const InternalTemplate = require('../../../src/modules/catalog/models/internalTemplate.model');
const Vendor = require('../../../src/modules/vendor/models/vendor.model');
const VendorProduct = require('../../../src/modules/vendor/models/vendorProduct.model');
const VendorCostCenter = require('../../../src/modules/vendor/models/vendorCostCenter.model');
const MappingSkuConfigRule = require('../../../src/modules/mapping/models/mappingSkuConfigRule.model');
const Shop = require('../../../src/modules/shop/models/shop.model');
const Listing = require('../../../src/modules/catalog/models/listing.model');
const { parseArgs, readJson } = require('./legacySetupUtils');

const DEFAULT_SEED_DIR = 'tmp/legacy-setup-audit/normalized';

function key(value) {
  return value == null ? null : String(value);
}

function pct(done, total) {
  return total ? Math.round((done / total) * 10000) / 100 : 0;
}

function bucketMissing(samples, type, row, limit = 20) {
  if (!samples[type]) samples[type] = [];
  if (samples[type].length < limit) samples[type].push(row);
}

async function loadDbState() {
  const [groups, templates, vendors, products, costCenters, skuRules, shops, listings] = await Promise.all([
    ProductTypeGroup.find({}).lean(),
    InternalTemplate.find({}).lean(),
    Vendor.find({}).lean(),
    VendorProduct.find({}).lean(),
    VendorCostCenter.find({}).lean(),
    MappingSkuConfigRule.find({}).lean(),
    Shop.find({}).lean(),
    Listing.find({}).lean(),
  ]);
  return {
    groupCodes: new Set(groups.map((row) => row.code)),
    templateCodes: new Set(templates.map((row) => row.code)),
    vendorCodes: new Set(vendors.map((row) => row.code)),
    productKeys: new Set(products.map((row) => `${key(row.vendorId)}:${row.code}`)),
    productByCode: new Map(products.map((row) => [row.code, row])),
    costKeys: new Set(costCenters.map((row) => `${key(row.vendorProductId)}:${row.code}`)),
    skuRuleKeys: new Set(skuRules.map((row) => [
      key(row.shopId),
      row.salesChannelCode || '',
      row.marketplaceCode || '',
      row.configCode,
      key(row.productTypeGroupId),
      row.countryCode || '',
    ].join('|'))),
    shopNames: new Set(shops.map((row) => String(row.name || '').trim().toUpperCase())),
    listingSkuKeys: new Set(listings.map((row) => [
      key(row.shopId),
      row.salesChannelCode,
      row.marketplaceCode,
      row.sku,
    ].join('|'))),
    counts: {
      productTypeGroups: groups.length,
      internalTemplates: templates.length,
      vendors: vendors.length,
      vendorProducts: products.length,
      vendorCostCenters: costCenters.length,
      skuConfigRules: skuRules.length,
      shops: shops.length,
      listings: listings.length,
    },
  };
}

function auditSeedLinks(seeds, dbState, defaultShopName) {
  const samples = {};
  const productGroupsReady = seeds.productTypeGroups.filter((row) => dbState.groupCodes.has(row.code)).length;
  const templatesReady = seeds.internalTemplates.filter((row) => {
    const ready = dbState.templateCodes.has(row.code) && dbState.groupCodes.has(row.productTypeGroupCode);
    if (!ready) bucketMissing(samples, 'templateMissingLink', { code: row.code, productTypeGroupCode: row.productTypeGroupCode });
    return ready;
  }).length;
  const vendorsReady = seeds.vendors.filter((row) => dbState.vendorCodes.has(row.code)).length;
  const vendorProductsReady = seeds.vendorProducts.filter((row) => {
    const vendorReady = dbState.vendorCodes.has(row.vendorCode);
    const groupReady = dbState.groupCodes.has(row.productTypeGroupCode);
    if (!vendorReady || !groupReady) {
      bucketMissing(samples, 'vendorProductMissingLink', {
        code: row.code,
        vendorCode: row.vendorCode,
        productTypeGroupCode: row.productTypeGroupCode,
      });
    }
    return vendorReady && groupReady;
  }).length;
  const costCentersReady = seeds.vendorCostCenters.filter((row) => {
    const product = dbState.productByCode.get(row.vendorProductCode);
    const ready = product && dbState.costKeys.has(`${key(product._id)}:${row.code}`);
    if (!ready) bucketMissing(samples, 'vendorCostCenterMissingProductOrRow', {
      code: row.code,
      vendorCode: row.vendorCode,
      vendorProductCode: row.vendorProductCode,
    });
    return ready;
  }).length;
  const skuRulesLinkReady = seeds.skuConfigRules.filter((row) => {
    const ready = dbState.groupCodes.has(row.productTypeGroupCode)
      && (!row.internalTemplateCode || dbState.templateCodes.has(row.internalTemplateCode));
    if (!ready) bucketMissing(samples, 'skuConfigMissingLink', {
      configCode: row.configCode,
      productTypeGroupCode: row.productTypeGroupCode,
      internalTemplateCode: row.internalTemplateCode,
    });
    return ready;
  }).length;
  const listingsLinkReady = seeds.listings.filter((row) => {
    const shopName = row.shopName || defaultShopName;
    const ready = Boolean(shopName)
      && dbState.shopNames.has(String(shopName).trim().toUpperCase())
      && dbState.groupCodes.has(row.productTypeGroupCode)
      && Boolean(row.sku)
      && Boolean(row.title);
    if (!ready) bucketMissing(samples, 'listingMissingLink', {
      asin: row.asin,
      sku: row.sku,
      shopName: shopName || null,
      productTypeGroupCode: row.productTypeGroupCode,
    });
    return ready;
  }).length;

  return {
    productTypeGroups: { ready: productGroupsReady, total: seeds.productTypeGroups.length, pct: pct(productGroupsReady, seeds.productTypeGroups.length) },
    internalTemplates: { ready: templatesReady, total: seeds.internalTemplates.length, pct: pct(templatesReady, seeds.internalTemplates.length) },
    vendors: { ready: vendorsReady, total: seeds.vendors.length, pct: pct(vendorsReady, seeds.vendors.length) },
    vendorProducts: { ready: vendorProductsReady, total: seeds.vendorProducts.length, pct: pct(vendorProductsReady, seeds.vendorProducts.length) },
    vendorCostCenters: { ready: costCentersReady, total: seeds.vendorCostCenters.length, pct: pct(costCentersReady, seeds.vendorCostCenters.length) },
    skuConfigRules: { linkReady: skuRulesLinkReady, total: seeds.skuConfigRules.length, pct: pct(skuRulesLinkReady, seeds.skuConfigRules.length) },
    listings: { linkReady: listingsLinkReady, total: seeds.listings.length, pct: pct(listingsLinkReady, seeds.listings.length) },
    samples,
  };
}

function loadSeeds(dir) {
  return {
    productTypeGroups: readJson(path.join(dir, 'product-type-groups.seed.json'), []),
    internalTemplates: readJson(path.join(dir, 'internal-templates.seed.json'), []),
    vendors: readJson(path.join(dir, 'vendors.seed.json'), []),
    vendorProducts: readJson(path.join(dir, 'vendor-products.seed.json'), []),
    vendorCostCenters: readJson(path.join(dir, 'vendor-cost-centers.seed.json'), []),
    skuConfigRules: readJson(path.join(dir, 'sku-config-rules.seed.json'), []),
    listings: readJson(path.join(dir, 'listing-candidates.seed.json'), []),
  };
}

async function auditSetupReadiness({ dir = DEFAULT_SEED_DIR, defaultShopName = null } = {}) {
  const seeds = loadSeeds(dir);
  const dbState = await loadDbState();
  const seedLinks = auditSeedLinks(seeds, dbState, defaultShopName);
  const importableCore = [
    seedLinks.productTypeGroups.pct,
    seedLinks.internalTemplates.pct,
    seedLinks.vendors.pct,
    seedLinks.vendorProducts.pct,
    seedLinks.vendorCostCenters.pct,
    seedLinks.skuConfigRules.pct,
  ];

  return {
    dir,
    defaultShopName: defaultShopName || null,
    currentDbCounts: dbState.counts,
    seedCounts: Object.fromEntries(Object.entries(seeds).map(([name, rows]) => [name, rows.length])),
    readiness: {
      coreSetupPct: Math.round((importableCore.reduce((sum, value) => sum + value, 0) / importableCore.length) * 100) / 100,
      ...seedLinks,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    dir: DEFAULT_SEED_DIR,
    defaultShopName: null,
  });
  await connectDatabase();
  try {
    const summary = await auditSetupReadiness({
      dir: path.resolve(args.dir),
      defaultShopName: args.defaultShopName || null,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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
  auditSetupReadiness,
};
