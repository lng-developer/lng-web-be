const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const ProductTypeGroup = require('../../../src/modules/catalog/models/productTypeGroup.model');
const InternalTemplate = require('../../../src/modules/catalog/models/internalTemplate.model');
const Listing = require('../../../src/modules/catalog/models/listing.model');
const MappingSkuConfigRule = require('../../../src/modules/mapping/models/mappingSkuConfigRule.model');
const VendorRoutingRule = require('../../../src/modules/mapping/models/vendorRoutingRule.model');
const Vendor = require('../../../src/modules/vendor/models/vendor.model');
const VendorProduct = require('../../../src/modules/vendor/models/vendorProduct.model');
const VendorCostCenter = require('../../../src/modules/vendor/models/vendorCostCenter.model');
const { parseArgs } = require('./legacySetupUtils');

const PACKS = [15, 30, 50, 100, 200];

function action(summary, bucket, type) {
  summary[bucket][type] = (summary[bucket][type] || 0) + 1;
}

async function upsert({ model, filter, payload, dryRun, summary, bucket }) {
  const existing = await model.findOne(filter).lean();
  action(summary, bucket, existing ? 'update' : 'create');
  if (dryRun) return existing || payload;
  return model.findOneAndUpdate(filter, { $set: payload }, {
    upsert: true,
    returnDocument: 'after',
    runValidators: true,
    setDefaultsOnInsert: true,
  }).lean();
}

function normalizeSize(value) {
  const match = String(value || '').toUpperCase().match(/(\d+(?:\.\d+)?)\s*[X*×]\s*(\d+(?:\.\d+)?)/);
  return match ? `${match[1]}X${match[2]}` : null;
}

function inferSize(costCenter) {
  return normalizeSize([costCenter.standardSize, costCenter.name, costCenter.code].filter(Boolean).join(' '));
}

function inferPack(costCenter) {
  const match = [costCenter.standardColor, costCenter.name, costCenter.code]
    .filter(Boolean)
    .join(' ')
    .match(/\b(?:PACK\s*)?(\d+)\s*PCS\b/i);
  return match ? `${match[1]} pcs` : null;
}

async function seedEtsyNkReadiness({ dryRun = true } = {}) {
  const summary = {
    dryRun,
    productTypeGroups: {},
    internalTemplates: {},
    skuConfigRules: {},
    vendors: {},
    vendorProducts: {},
    vendorCostCenters: {},
    vendorRoutingRules: {},
    listings: {},
    warnings: [],
  };

  const group = await upsert({
    model: ProductTypeGroup,
    filter: { code: 'NAPKINS' },
    payload: { code: 'NAPKINS', name: 'Napkins', status: 'ACTIVE' },
    dryRun,
    summary,
    bucket: 'productTypeGroups',
  });

  const template = await upsert({
    model: InternalTemplate,
    filter: { code: 'NAPKINS_DEFAULT' },
    payload: {
      code: 'NAPKINS_DEFAULT',
      name: 'Napkins Default',
      productTypeGroupId: group._id,
      requiredFields: [],
      artworkSlots: [{
        key: 'FRONT',
        label: 'Front',
        type: 'MIXED',
        required: true,
        acceptedFieldKeys: ['Photo', 'Custom Name', 'Names'],
        sortOrder: 0,
      }],
      designAssets: [],
      status: 'ACTIVE',
    },
    dryRun,
    summary,
    bucket: 'internalTemplates',
  });

  const vendor = await upsert({
    model: Vendor,
    filter: { code: 'LNG_GROUP' },
    payload: {
      code: 'LNG_GROUP',
      name: 'LNG Group',
      providerKey: 'LNG_GROUP',
      fulfillmentType: 'POD',
      status: 'ACTIVE',
    },
    dryRun,
    summary,
    bucket: 'vendors',
  });

  const products = await VendorProduct.find({ vendorId: vendor._id, productTypeGroupId: group._id }).sort({ code: 1 }).lean();
  const keepProduct = products.find((product) => product.code === 'PRODUCT_LNG_001')
    || products.find((product) => product.code === 'LNG_001')
    || await upsert({
      model: VendorProduct,
      filter: { vendorId: vendor._id, code: 'PRODUCT_LNG_001' },
      payload: {
        vendorId: vendor._id,
        productTypeGroupId: group._id,
        code: 'PRODUCT_LNG_001',
        name: 'Napkins',
        baseCostAmount: 0,
        currency: 'USD',
        status: 'ACTIVE',
      },
      dryRun,
      summary,
      bucket: 'vendorProducts',
    });

  for (const product of products.filter((product) => String(product._id) !== String(keepProduct._id) && product.status === 'ACTIVE')) {
    action(summary, 'vendorProducts', 'deactivateDuplicate');
    if (!dryRun) {
      await VendorProduct.updateOne({ _id: product._id }, { $set: { status: 'INACTIVE' } });
    }
  }

  const skuRule = await upsert({
    model: MappingSkuConfigRule,
    filter: {
      shopId: null,
      salesChannelCode: null,
      marketplaceCode: null,
      configCode: 'NK',
      productTypeGroupId: group._id,
      countryCode: null,
    },
    payload: {
      shopId: null,
      salesChannelCode: null,
      marketplaceCode: null,
      configCode: 'NK',
      productTypeGroupId: group._id,
      internalTemplateId: template._id,
      sizeKeys: ['Sizes', 'Select Size'],
      colorKeys: ['Quantity', 'Select Pack', 'Pack', 'Ink Color'],
      combinationKeys: [],
      priority: 50,
      status: 'ACTIVE',
    },
    dryRun,
    summary,
    bucket: 'skuConfigRules',
  });

  const duplicateSkuRules = await MappingSkuConfigRule.find({
    _id: { $ne: skuRule._id },
    shopId: null,
    salesChannelCode: { $in: [null, 'ETSY'] },
    configCode: 'NK',
    productTypeGroupId: group._id,
    internalTemplateId: template._id,
    status: 'ACTIVE',
  }).lean();
  for (const rule of duplicateSkuRules) {
    action(summary, 'skuConfigRules', 'deactivateDuplicate');
    if (!dryRun) {
      await MappingSkuConfigRule.updateOne({ _id: rule._id }, { $set: { status: 'INACTIVE' } });
    }
  }

  for (const pack of PACKS) {
    await upsert({
      model: VendorCostCenter,
      filter: { vendorProductId: keepProduct._id, sku: `LNGNKS${pack}` },
      payload: {
        vendorProductId: keepProduct._id,
        vendorId: vendor._id,
        code: `LNGNKS${pack}`,
        name: `4.8" x 4.8" / ${pack} pcs`,
        sku: `LNGNKS${pack}`,
        standardSize: '4.8X4.8',
        standardColor: `${pack} pcs`,
        baseCostAmount: 0,
        currency: 'USD',
        status: 'ACTIVE',
      },
      dryRun,
      summary,
      bucket: 'vendorCostCenters',
    });
  }

  const existingCostCenters = await VendorCostCenter.find({ vendorProductId: keepProduct._id }).lean();
  for (const costCenter of existingCostCenters) {
    const standardSize = inferSize(costCenter);
    const standardColor = inferPack(costCenter);
    if (!standardSize && !standardColor) continue;
    action(summary, 'vendorCostCenters', 'normalizeExisting');
    if (!dryRun) {
      await VendorCostCenter.updateOne({ _id: costCenter._id }, {
        $set: {
          ...(standardSize ? { standardSize } : {}),
          ...(standardColor ? { standardColor } : {}),
        },
      });
    }
  }

  await upsert({
    model: VendorRoutingRule,
    filter: {
      shopId: null,
      salesChannelCode: null,
      marketplaceCode: null,
      productTypeGroupId: group._id,
      vendorId: vendor._id,
      configCode: 'NK',
      normalizedSize: null,
      normalizedColor: null,
    },
    payload: {
      shopId: null,
      salesChannelCode: null,
      marketplaceCode: null,
      productTypeGroupId: group._id,
      vendorId: vendor._id,
      configCode: 'NK',
      normalizedSize: null,
      normalizedColor: null,
      priority: 10,
      status: 'ACTIVE',
    },
    dryRun,
    summary,
    bucket: 'vendorRoutingRules',
  });

  const listingFilter = {
    salesChannelCode: 'ETSY',
    productTypeGroupId: group._id,
    $or: [{ internalTemplateId: null }, { internalTemplateId: { $exists: false } }],
  };
  const listingsToUpdate = await Listing.countDocuments(listingFilter);
  summary.listings.attachTemplate = listingsToUpdate;
  if (!dryRun && listingsToUpdate) {
    await Listing.updateMany(listingFilter, { $set: { internalTemplateId: template._id } });
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { dryRun: 'true' });
  await connectDatabase();
  try {
    const summary = await seedEtsyNkReadiness({
      dryRun: String(args.dryRun).toLowerCase() !== 'false',
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
  seedEtsyNkReadiness,
};
