const path = require('path');

const { connectDatabase, disconnectDatabase } = require('../../config/database');
const ProductTypeGroup = require('../../modules/catalog/models/productTypeGroup.model');
const InternalTemplate = require('../../modules/catalog/models/internalTemplate.model');
const Listing = require('../../modules/catalog/models/listing.model');
const Vendor = require('../../modules/vendor/models/vendor.model');
const VendorProduct = require('../../modules/vendor/models/vendorProduct.model');
const VendorCostCenter = require('../../modules/vendor/models/vendorCostCenter.model');
const MappingSkuConfigRule = require('../../modules/mapping/models/mappingSkuConfigRule.model');
const Shop = require('../../modules/shop/models/shop.model');
const { parseArgs, readJson } = require('./legacySetupUtils');

const DEFAULT_SEED_DIR = 'tmp/legacy-setup-audit/normalized';

function idOf(value) {
  return value ? String(value._id || value.id || value) : null;
}

function compact(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function countBucket(summary, bucket, key) {
  summary[bucket][key] = (summary[bucket][key] || 0) + 1;
}

async function upsertModel({ model, filter, payload, dryRun, summary, bucket }) {
  const hasDryRunId = Object.values(filter).some((value) => String(value || '').startsWith('dryrun:'));
  if (dryRun && hasDryRunId) {
    countBucket(summary, bucket, 'create');
    return payload;
  }
  const existing = await model.findOne(filter).lean();
  countBucket(summary, bucket, existing ? 'update' : 'create');
  if (dryRun) return existing || payload;
  return model.findOneAndUpdate(
    filter,
    { $set: payload },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  ).lean();
}

async function buildLookups() {
  const [groups, templates, vendors, products, shops] = await Promise.all([
    ProductTypeGroup.find({}).lean(),
    InternalTemplate.find({}).lean(),
    Vendor.find({}).lean(),
    VendorProduct.find({}).lean(),
    Shop.find({}).lean(),
  ]);
  return {
    groupByCode: new Map(groups.map((row) => [row.code, row])),
    templateByCode: new Map(templates.map((row) => [row.code, row])),
    vendorByCode: new Map(vendors.map((row) => [row.code, row])),
    productByVendorCode: new Map(products.map((row) => [`${idOf(row.vendorId)}:${row.code}`, row])),
    shopByName: new Map(shops.map((row) => [String(row.name || '').trim().toUpperCase(), row])),
  };
}

async function refreshLookup(map, model, key) {
  const rows = await model.find({}).lean();
  map.clear();
  rows.forEach((row) => map.set(row[key], row));
}

async function importProductGroups(rows, context) {
  for (const row of rows) {
    await upsertModel({
      model: ProductTypeGroup,
      filter: { code: row.code },
      payload: {
        code: row.code,
        name: row.name,
        sortOrder: row.sortOrder || 0,
        status: row.status || 'ACTIVE',
      },
      ...context,
      bucket: 'productTypeGroups',
    });
  }
  if (context.dryRun) {
    rows.forEach((row) => {
      if (!context.lookups.groupByCode.has(row.code)) {
        context.lookups.groupByCode.set(row.code, { _id: `dryrun:group:${row.code}`, code: row.code });
      }
    });
    return;
  }
  await refreshLookup(context.lookups.groupByCode, ProductTypeGroup, 'code');
}

async function importTemplates(rows, context) {
  for (const row of rows) {
    const group = context.lookups.groupByCode.get(row.productTypeGroupCode);
    if (!group) {
      context.summary.warnings.push({ type: 'TEMPLATE_SKIPPED_MISSING_PRODUCT_GROUP', code: row.code, productTypeGroupCode: row.productTypeGroupCode });
      countBucket(context.summary, 'internalTemplates', 'skip');
      continue;
    }
    await upsertModel({
      model: InternalTemplate,
      filter: { code: row.code },
      payload: {
        code: row.code,
        name: row.name,
        description: row.description || null,
        productTypeGroupId: group._id,
        requiredFields: row.requiredFields || [],
        artworkSlots: row.artworkSlots || [],
        designAssets: row.designAssets || [],
        status: row.status || 'ACTIVE',
      },
      ...context,
      bucket: 'internalTemplates',
    });
  }
  if (context.dryRun) {
    rows.forEach((row) => {
      if (!context.lookups.templateByCode.has(row.code)) {
        context.lookups.templateByCode.set(row.code, { _id: `dryrun:template:${row.code}`, code: row.code });
      }
    });
    return;
  }
  await refreshLookup(context.lookups.templateByCode, InternalTemplate, 'code');
}

async function importVendors(rows, context) {
  for (const row of rows) {
    await upsertModel({
      model: Vendor,
      filter: { code: row.code },
      payload: {
        code: row.code,
        name: row.name,
        providerKey: row.providerKey || 'CUSTOM',
        fulfillmentType: row.fulfillmentType || 'CUSTOM',
        status: row.status || 'ACTIVE',
        metadata: compact({ legacyId: row.legacyId }),
      },
      ...context,
      bucket: 'vendors',
    });
  }
  if (context.dryRun) {
    rows.forEach((row) => {
      if (!context.lookups.vendorByCode.has(row.code)) {
        context.lookups.vendorByCode.set(row.code, { _id: `dryrun:vendor:${row.code}`, code: row.code });
      }
    });
    return;
  }
  await refreshLookup(context.lookups.vendorByCode, Vendor, 'code');
}

async function importVendorProducts(rows, context) {
  for (const row of rows) {
    const vendor = context.lookups.vendorByCode.get(row.vendorCode);
    const group = context.lookups.groupByCode.get(row.productTypeGroupCode);
    if (!vendor || !group) {
      context.summary.warnings.push({
        type: 'VENDOR_PRODUCT_SKIPPED_MISSING_LINK',
        code: row.code,
        vendorCode: row.vendorCode,
        productTypeGroupCode: row.productTypeGroupCode,
      });
      countBucket(context.summary, 'vendorProducts', 'skip');
      continue;
    }
    await upsertModel({
      model: VendorProduct,
      filter: { vendorId: vendor._id, code: row.code },
      payload: {
        vendorId: vendor._id,
        productTypeGroupId: group._id,
        code: row.code,
        name: row.name,
        externalProductId: row.externalProductId || null,
        baseCostAmount: row.baseCostAmount || 0,
        currency: row.currency || 'USD',
        status: row.status || 'ACTIVE',
        metadata: compact({ legacyId: row.legacyId, legacyVendorId: row.legacyVendorId }),
      },
      ...context,
      bucket: 'vendorProducts',
    });
  }
  if (context.dryRun) {
    rows.forEach((row) => {
      const vendor = context.lookups.vendorByCode.get(row.vendorCode);
      if (!vendor) return;
      const key = `${idOf(vendor)}:${row.code}`;
      if (!context.lookups.productByVendorCode.has(key)) {
        context.lookups.productByVendorCode.set(key, {
          _id: `dryrun:product:${row.vendorCode}:${row.code}`,
          vendorId: vendor._id,
          code: row.code,
        });
      }
    });
    return;
  }
  const products = await VendorProduct.find({}).lean();
  context.lookups.productByVendorCode = new Map(products.map((row) => [`${idOf(row.vendorId)}:${row.code}`, row]));
}

async function importVendorCostCenters(rows, context) {
  for (const row of rows) {
    const vendor = context.lookups.vendorByCode.get(row.vendorCode);
    const product = vendor && context.lookups.productByVendorCode.get(`${idOf(vendor)}:${row.vendorProductCode}`);
    if (!vendor || !product) {
      context.summary.warnings.push({
        type: 'VENDOR_COST_CENTER_SKIPPED_MISSING_PRODUCT',
        code: row.code,
        vendorCode: row.vendorCode,
        vendorProductCode: row.vendorProductCode,
      });
      countBucket(context.summary, 'vendorCostCenters', 'skip');
      continue;
    }
    await upsertModel({
      model: VendorCostCenter,
      filter: { vendorProductId: product._id, code: row.code },
      payload: {
        vendorProductId: product._id,
        vendorId: vendor._id,
        code: row.code,
        name: row.name,
        sku: row.sku || null,
        vendorSize: row.vendorSize || null,
        vendorColor: row.vendorColor || null,
        standardSize: row.standardSize || null,
        standardColor: row.standardColor || null,
        baseCostAmount: row.baseCostAmount || 0,
        currency: row.currency || 'USD',
        domesticShipping: row.domesticShipping || {},
        internationalShipping: row.internationalShipping || {},
        priorityShipping: row.priorityShipping || {},
        status: row.status || 'ACTIVE',
        metadata: compact({ legacyId: row.legacyId, legacyVendorProductId: row.legacyVendorProductId }),
      },
      ...context,
      bucket: 'vendorCostCenters',
    });
  }
}

function resolveShop(row, context) {
  const name = row.shopName || context.defaultShopName;
  return name ? context.lookups.shopByName.get(String(name).trim().toUpperCase()) : null;
}

async function importSkuConfigRules(rows, context) {
  for (const row of rows) {
    const group = context.lookups.groupByCode.get(row.productTypeGroupCode);
    const template = row.internalTemplateCode ? context.lookups.templateByCode.get(row.internalTemplateCode) : null;
    const shop = resolveShop(row, context);
    if (!group) {
      context.summary.warnings.push({ type: 'SKU_CONFIG_SKIPPED_MISSING_PRODUCT_GROUP', configCode: row.configCode, productTypeGroupCode: row.productTypeGroupCode });
      countBucket(context.summary, 'skuConfigRules', 'skip');
      continue;
    }
    await upsertModel({
      model: MappingSkuConfigRule,
      filter: {
        shopId: shop?._id || null,
        salesChannelCode: row.salesChannelCode || null,
        marketplaceCode: row.marketplaceCode || null,
        configCode: row.configCode,
        productTypeGroupId: group._id,
        countryCode: row.countryCode || null,
      },
      payload: {
        shopId: shop?._id || null,
        salesChannelCode: row.salesChannelCode || null,
        marketplaceCode: row.marketplaceCode || null,
        configCode: row.configCode,
        productTypeAliases: row.productTypeAliases || [],
        platformProductType: row.platformProductType || null,
        countryCode: row.countryCode || null,
        combinationProductTypeKey: row.combinationProductTypeKey || null,
        sizeKeys: row.sizeKeys || [],
        colorKeys: row.colorKeys || [],
        productTypeKeys: row.productTypeKeys || [],
        productTypeColorKeys: row.productTypeColorKeys || [],
        productTypeSizeKeys: row.productTypeSizeKeys || [],
        combinationKeys: row.combinationKeys || [],
        attributeKeyMap: row.attributeKeyMap || {},
        defaultColor: row.defaultColor || null,
        isSet: Boolean(row.isSet),
        isPack: Boolean(row.isPack),
        sizePosition: row.sizePosition || 0,
        colorPosition: row.colorPosition || 0,
        productTypeGroupId: group._id,
        internalTemplateId: template?._id || null,
        priority: row.priority || 100,
        status: row.status || 'ACTIVE',
      },
      ...context,
      bucket: 'skuConfigRules',
    });
  }
}

async function importListings(rows, context) {
  for (const row of rows) {
    const shop = resolveShop(row, context);
    const group = context.lookups.groupByCode.get(row.productTypeGroupCode);
    const template = row.internalTemplateCode ? context.lookups.templateByCode.get(row.internalTemplateCode) : null;
    if (!shop || !group || !row.sku || !row.title) {
      context.summary.warnings.push({
        type: 'LISTING_SKIPPED_MISSING_REQUIRED_LINK',
        asin: row.asin,
        sku: row.sku,
        shopName: row.shopName || context.defaultShopName || null,
        productTypeGroupCode: row.productTypeGroupCode,
      });
      countBucket(context.summary, 'listings', 'skip');
      continue;
    }
    const listingFilter = row.asin
      ? {
          shopId: shop._id,
          salesChannelCode: row.salesChannelCode,
          marketplaceCode: row.marketplaceCode,
          asin: row.asin,
        }
      : {
          shopId: shop._id,
          salesChannelCode: row.salesChannelCode,
          marketplaceCode: row.marketplaceCode,
          sku: row.sku,
        };
    await upsertModel({
      model: Listing,
      filter: listingFilter,
      payload: {
        shopId: shop._id,
        salesChannelCode: row.salesChannelCode,
        marketplaceCode: row.marketplaceCode,
        sku: row.sku,
        asin: row.asin || null,
        title: row.title,
        productTypeGroupId: group._id,
        internalTemplateId: template?._id || null,
        psdStatus: row.psdStatus || 'MISSING',
        costCenterStatus: row.costCenterStatus || 'MISSING',
        status: row.status || 'ACTIVE',
        qcStatus: row.qcStatus || 'APPROVED',
        approvedBy: null,
        approvedAt: new Date(),
      },
      ...context,
      bucket: 'listings',
    });
  }
}

function emptySummary({ dir, dryRun, defaultShopName }) {
  return {
    dir,
    dryRun,
    defaultShopName: defaultShopName || null,
    productTypeGroups: {},
    internalTemplates: {},
    vendors: {},
    vendorProducts: {},
    vendorCostCenters: {},
    skuConfigRules: {},
    listings: {},
    warnings: [],
  };
}

async function importLegacySetupSeeds({
  dir = DEFAULT_SEED_DIR,
  dryRun = true,
  defaultShopName = null,
} = {}) {
  const summary = emptySummary({ dir, dryRun, defaultShopName });
  const lookups = await buildLookups();
  const context = {
    dryRun,
    defaultShopName,
    lookups,
    summary,
  };

  await importProductGroups(readJson(path.join(dir, 'product-type-groups.seed.json'), []), context);
  await importTemplates(readJson(path.join(dir, 'internal-templates.seed.json'), []), context);
  await importVendors(readJson(path.join(dir, 'vendors.seed.json'), []), context);
  await importVendorProducts(readJson(path.join(dir, 'vendor-products.seed.json'), []), context);
  await importVendorCostCenters(readJson(path.join(dir, 'vendor-cost-centers.seed.json'), []), context);
  await importSkuConfigRules(readJson(path.join(dir, 'sku-config-rules.seed.json'), []), context);
  await importListings(readJson(path.join(dir, 'listing-candidates.seed.json'), []), context);

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    dir: DEFAULT_SEED_DIR,
    dryRun: 'true',
    defaultShopName: null,
  });
  await connectDatabase();
  try {
    const summary = await importLegacySetupSeeds({
      dir: path.resolve(args.dir),
      dryRun: String(args.dryRun).toLowerCase() !== 'false',
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
  importLegacySetupSeeds,
};
