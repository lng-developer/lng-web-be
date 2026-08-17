const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Listing = require('../models/listing.model');
const ListingVariant = require('../models/listingVariant.model');
const {
  listingQcStatuses,
  recordStatuses,
  salesChannelCodes,
} = require('../constants/catalog.constants');

const DEFAULT_OLD_ENV_FILE = 'C:/lng-web-v1/lng-website/.env';
const SAMPLE_LIMIT = 20;

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    if (!key) return args;
    return {
      ...args,
      [key]: valueParts.length > 0 ? valueParts.join('=') : true,
    };
  }, {
    dryRun: 'true',
    limit: null,
    oldEnv: DEFAULT_OLD_ENV_FILE,
    out: null,
    asin: null,
    source: 'all',
    map: null,
  });
}

function readEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function legacyMongoUriFromEnv(filePath) {
  const env = readEnvFile(filePath);
  return env.MONGO_URI || env.MONGODB_URI;
}

function readJsonFile(filePath) {
  if (!filePath) return {};
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function normalizeUpper(value) {
  const text = String(value || '').trim().toUpperCase();
  return text || null;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addSample(samples, key, row) {
  if (!samples[key]) samples[key] = [];
  if (samples[key].length < SAMPLE_LIMIT) samples[key].push(row);
}

function emptySummary({ dryRun, limit, oldEnv, asin } = {}) {
  return {
    dryRun,
    limit: limit || null,
    asin: asin || null,
    oldEnv,
    oldDatabase: null,
    newDatabase: null,
    scanned: 0,
    eligibleCount: 0,
    createdCount: 0,
    existingCount: 0,
    raceExistingCount: 0,
    missingAsinCount: 0,
    missingOrderItemCount: 0,
    missingSkuCount: 0,
    missingFulfillmentPlanCount: 0,
    missingProductTypeGroupCount: 0,
    missingShopMapCount: 0,
    missingProductTypeGroupMapCount: 0,
    duplicateIdentityCount: 0,
    hasLegacyPsdUrlCount: 0,
    createdVariantCount: 0,
    existingVariantCount: 0,
    skippedVariantCount: 0,
    samples: {},
  };
}

async function findOrderItemByAsin(asin) {
  return mongoose.connection.db.collection('orderitems').findOne(
    { asin },
    { sort: { updatedAt: -1, _id: -1 } },
  );
}

async function findFulfillmentPlanByOrderItemId(orderItemId) {
  return mongoose.connection.db.collection('fulfillmentplans').findOne({
    orderItemId,
    productTypeGroupId: { $ne: null },
  });
}

function legacyShopId(value) {
  return value || null;
}

function lookupMap(map = {}, value) {
  const key = toId(value);
  return key ? map[key] || null : null;
}

function legacyAmazonPsdUrl(oldListing = {}) {
  return String(oldListing.psd?.url || '').trim() || null;
}

function legacyEtsyPsdUrl(oldListing = {}) {
  return String(oldListing.designFile?.url || '').trim() || null;
}

function legacyPsdAssetId(oldListing = {}, mappings = {}, source) {
  const url = source === 'etsy' ? legacyEtsyPsdUrl(oldListing) : legacyAmazonPsdUrl(oldListing);
  if (!url) return null;
  return mappings.psdAssetByLegacyUrl?.[url] || null;
}

function normalizeMarketplace(value, fallback = 'US') {
  return normalizeUpper(value) || fallback;
}

async function buildAmazonListingPlan({ oldListing, item, plan, mappings, summary }) {
  const sku = normalizeUpper(item?.sku || oldListing.asin);
  const shopId = item?.shopId || lookupMap(mappings.shopByLegacyId, oldListing.store) || legacyShopId(oldListing.store);
  if (!shopId) {
    summary.missingShopMapCount += 1;
    addSample(summary.samples, 'missingShopMap', { source: 'amazon', legacyId: toId(oldListing), asin: oldListing.asin, legacyShopId: toId(oldListing.store) });
    return null;
  }

  return {
    identity: {
      shopId,
      salesChannelCode: salesChannelCodes.AMAZON,
      marketplaceCode: normalizeMarketplace(item?.marketplaceCode),
      sku,
    },
    listingPayload: {
      shopId,
      salesChannelCode: salesChannelCodes.AMAZON,
      marketplaceCode: normalizeMarketplace(item?.marketplaceCode),
      sku,
      asin: normalizeUpper(oldListing.asin),
      etsyListingId: null,
      title: String(item?.title || oldListing.template?.design_product || oldListing.asin || sku).trim(),
      productImageUrl: String(oldListing.product_image || item?.productImageUrl || '').trim() || null,
      baseCostAmount: 0,
      currency: normalizeUpper(item?.price?.currency) || 'USD',
      status: recordStatuses.ACTIVE,
      qcStatus: listingQcStatuses.APPROVED,
      approvedBy: null,
      approvedAt: new Date(),
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
    variantPayload: {
      productTypeGroupId: plan?.productTypeGroupId || null,
      internalTemplateId: plan?.internalTemplateId || null,
      psdTemplateAssetId: legacyPsdAssetId(oldListing, mappings, 'amazon'),
      previewAssetId: null,
      printMethod: plan?.printMethod || null,
      status: recordStatuses.ACTIVE,
    },
  };
}

function normalizeEtsyListing(oldListing = {}) {
  const skus = [
    oldListing.SKU,
    oldListing.sku,
    ...(Array.isArray(oldListing.skus) ? oldListing.skus : []),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return {
    listingId: String(oldListing.listingId || '').trim(),
    sku: normalizeUpper(skus[0]),
    title: String(oldListing.title || oldListing.TITLE || oldListing.listingId || '').trim(),
    imageUrl: String(oldListing.imageUrl || oldListing.IMAGE1 || '').trim() || null,
  };
}

async function buildEtsyListingPlan({ oldListing, mappings, summary }) {
  const normalized = normalizeEtsyListing(oldListing);
  const shopId = lookupMap(mappings.shopByLegacyId, oldListing.shopId) || legacyShopId(oldListing.shopId);
  if (!shopId) {
    summary.missingShopMapCount += 1;
    addSample(summary.samples, 'missingShopMap', { source: 'etsy', legacyId: toId(oldListing), listingId: normalized.listingId, legacyShopId: toId(oldListing.shopId) });
    return null;
  }

  const productTypeGroupId = lookupMap(mappings.productTypeGroupByLegacyEtsyListingId, normalized.listingId)
    || lookupMap(mappings.productTypeGroupBySku, normalized.sku)
    || null;
  if (!productTypeGroupId) {
    summary.missingProductTypeGroupMapCount += 1;
    addSample(summary.samples, 'missingProductTypeGroupMap', { source: 'etsy', legacyId: toId(oldListing), listingId: normalized.listingId, sku: normalized.sku });
  }

  const internalTemplateId = lookupMap(mappings.internalTemplateByLegacyEtsyListingId, normalized.listingId)
    || lookupMap(mappings.internalTemplateBySku, normalized.sku)
    || null;

  return {
    identity: {
      shopId,
      salesChannelCode: salesChannelCodes.ETSY,
      marketplaceCode: normalizeMarketplace(oldListing.marketplaceCode),
      sku: normalized.sku,
      etsyListingId: normalized.listingId,
    },
    listingPayload: {
      shopId,
      salesChannelCode: salesChannelCodes.ETSY,
      marketplaceCode: normalizeMarketplace(oldListing.marketplaceCode),
      sku: normalized.sku,
      asin: null,
      etsyListingId: normalized.listingId,
      title: normalized.title || normalized.sku,
      productImageUrl: normalized.imageUrl,
      baseCostAmount: 0,
      currency: 'USD',
      status: recordStatuses.ACTIVE,
      qcStatus: listingQcStatuses.APPROVED,
      approvedBy: null,
      approvedAt: new Date(),
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
    variantPayload: {
      productTypeGroupId,
      internalTemplateId,
      psdTemplateAssetId: legacyPsdAssetId(oldListing, mappings, 'etsy'),
      previewAssetId: null,
      printMethod: null,
      status: recordStatuses.ACTIVE,
    },
  };
}

async function buildListingPayload({ oldListing, item, plan, mappings, summary }) {
  const sku = normalizeUpper(item?.sku || oldListing.asin);
  if (!sku) return null;
  return buildAmazonListingPlan({ oldListing, item: { ...item, sku }, plan, mappings, summary });
}

async function assessLegacyAmazonListing(oldListing, summary, mappings = {}) {
  const legacyId = toId(oldListing);
  const asin = normalizeUpper(oldListing.asin);
  if (!asin) {
    summary.missingAsinCount += 1;
    addSample(summary.samples, 'missingAsin', { legacyId });
    return null;
  }

  if (legacyAmazonPsdUrl(oldListing)) summary.hasLegacyPsdUrlCount += 1;

  const item = await findOrderItemByAsin(asin);
  if (!item) {
    summary.missingOrderItemCount += 1;
    addSample(summary.samples, 'missingOrderItem', { legacyId, asin });
  }

  if (item && !normalizeUpper(item.sku)) {
    summary.missingSkuCount += 1;
    addSample(summary.samples, 'missingSku', { legacyId, asin, orderItemId: toId(item) });
    return null;
  }

  const plan = item ? await findFulfillmentPlanByOrderItemId(item._id) : null;
  if (!plan) {
    summary.missingFulfillmentPlanCount += 1;
    addSample(summary.samples, 'missingFulfillmentPlan', {
      legacyId,
      asin,
      orderItemId: toId(item),
      sku: item?.sku || asin,
    });
  }

  if (plan && !plan.productTypeGroupId) {
    summary.missingProductTypeGroupCount += 1;
    addSample(summary.samples, 'missingProductTypeGroup', {
      legacyId,
      asin,
      orderItemId: toId(item),
      fulfillmentPlanId: toId(plan),
    });
    return null;
  }

  const candidate = await buildListingPayload({ oldListing, item, plan, mappings, summary });
  if (!candidate) return null;
  const { identity, listingPayload, variantPayload } = candidate;
  const existingCount = await Listing.countDocuments(identity);
  if (existingCount > 1) {
    summary.duplicateIdentityCount += 1;
    addSample(summary.samples, 'duplicateIdentity', { legacyId, asin, identity, count: existingCount });
    return null;
  }
  if (existingCount === 1) {
    summary.existingCount += 1;
    addSample(summary.samples, 'existing', { legacyId, asin, identity });
    return null;
  }

  summary.eligibleCount += 1;
  addSample(summary.samples, 'eligible', {
    legacyId,
    asin,
    orderItemId: toId(item),
    fulfillmentPlanId: toId(plan),
    identity,
    productTypeGroupId: toId(plan?.productTypeGroupId),
    internalTemplateId: toId(plan?.internalTemplateId),
    hasLegacyPsdUrl: Boolean(oldListing.psd?.url),
  });

  return { identity, listingPayload, variantPayload };
}

async function assessLegacyEtsyListing(oldListing, summary, mappings = {}) {
  const legacyId = toId(oldListing);
  const normalized = normalizeEtsyListing(oldListing);
  if (!normalized.listingId) {
    summary.missingAsinCount += 1;
    addSample(summary.samples, 'missingEtsyListingId', { legacyId });
    return null;
  }
  if (!normalized.sku) {
    summary.missingSkuCount += 1;
    addSample(summary.samples, 'missingSku', { source: 'etsy', legacyId, listingId: normalized.listingId });
    return null;
  }
  if (legacyEtsyPsdUrl(oldListing)) summary.hasLegacyPsdUrlCount += 1;

  const candidate = await buildEtsyListingPlan({ oldListing, mappings, summary });
  if (!candidate) return null;

  const existingCount = await Listing.countDocuments(candidate.identity);
  if (existingCount > 1) {
    summary.duplicateIdentityCount += 1;
    addSample(summary.samples, 'duplicateIdentity', { source: 'etsy', legacyId, listingId: normalized.listingId, identity: candidate.identity, count: existingCount });
    return null;
  }
  if (existingCount === 1) {
    summary.existingCount += 1;
    addSample(summary.samples, 'existing', { source: 'etsy', legacyId, listingId: normalized.listingId, identity: candidate.identity });
    return null;
  }

  summary.eligibleCount += 1;
  addSample(summary.samples, 'eligible', {
    source: 'etsy',
    legacyId,
    listingId: normalized.listingId,
    identity: candidate.identity,
    productTypeGroupId: toId(candidate.variantPayload.productTypeGroupId),
    internalTemplateId: toId(candidate.variantPayload.internalTemplateId),
    hasLegacyPsdUrl: Boolean(legacyEtsyPsdUrl(oldListing)),
  });

  return candidate;
}

async function upsertListingAndVariant(candidate) {
  const result = await Listing.updateOne(
    candidate.identity,
    { $setOnInsert: candidate.listingPayload },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  const listing = await Listing.findOne(candidate.identity).select('_id').lean();
  if (!listing) {
    return { listingCreated: result.upsertedCount > 0, variantCreated: false, variantExisting: false, variantSkipped: false };
  }
  if (!candidate.variantPayload.productTypeGroupId) {
    return { listingCreated: result.upsertedCount > 0, variantCreated: false, variantExisting: false, variantSkipped: true };
  }

  const variantFilter = {
    listingId: listing._id,
    productTypeGroupId: candidate.variantPayload.productTypeGroupId,
  };
  const existingVariant = await ListingVariant.findOne(variantFilter).select('_id').lean();
  if (existingVariant) {
    return { listingCreated: result.upsertedCount > 0, variantCreated: false, variantExisting: true, variantSkipped: false };
  }

  const variant = await ListingVariant.create({
    ...variantFilter,
    internalTemplateId: candidate.variantPayload.internalTemplateId || null,
    psdTemplateAssetId: candidate.variantPayload.psdTemplateAssetId || null,
    previewAssetId: candidate.variantPayload.previewAssetId || null,
    printMethod: candidate.variantPayload.printMethod || null,
    status: candidate.variantPayload.status || recordStatuses.ACTIVE,
  });
  return { listingCreated: result.upsertedCount > 0, variantCreated: true, variantExisting: false, variantSkipped: false };
}

async function migrateLegacyListings({
  dryRun = true,
  limit = null,
  oldEnv = DEFAULT_OLD_ENV_FILE,
  asin = null,
  source = 'all',
  mappings = {},
} = {}) {
  const oldMongoUri = legacyMongoUriFromEnv(oldEnv);
  if (!oldMongoUri) throw new Error(`Missing legacy Mongo URI in ${oldEnv}`);

  const oldConnection = await mongoose.createConnection(oldMongoUri, {
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  const normalizedAsin = normalizeUpper(asin);
  const summary = emptySummary({ dryRun, limit, oldEnv, asin: normalizedAsin });
  summary.oldDatabase = oldConnection.db.databaseName;
  summary.newDatabase = mongoose.connection.db?.databaseName || null;

  try {
    const shouldRunAmazon = ['all', 'amazon'].includes(String(source || '').toLowerCase());
    const shouldRunEtsy = ['all', 'etsy'].includes(String(source || '').toLowerCase());

    const legacyFilter = normalizedAsin
      ? { asin: { $regex: `^${escapeRegex(normalizedAsin)}$`, $options: 'i' } }
      : {};
    const numericLimit = Number(limit);

    if (shouldRunAmazon) {
      let cursor = oldConnection.db.collection('listings').find(legacyFilter).sort({ _id: 1 });
      if (Number.isInteger(numericLimit) && numericLimit > 0) cursor = cursor.limit(numericLimit);
      for await (const oldListing of cursor) {
        summary.scanned += 1;
        const candidate = await assessLegacyAmazonListing(oldListing, summary, mappings);
        if (!candidate || dryRun) continue;
        const result = await upsertListingAndVariant(candidate);
        if (result.listingCreated) summary.createdCount += 1;
        else summary.raceExistingCount += 1;
        if (result.variantCreated) summary.createdVariantCount += 1;
        if (result.variantExisting) summary.existingVariantCount += 1;
        if (result.variantSkipped) summary.skippedVariantCount += 1;
      }
    }

    if (shouldRunEtsy && !normalizedAsin) {
      let cursor = oldConnection.db.collection('etsylistings').find({}).sort({ _id: 1 });
      if (Number.isInteger(numericLimit) && numericLimit > 0) cursor = cursor.limit(numericLimit);
      for await (const oldListing of cursor) {
        summary.scanned += 1;
        const candidate = await assessLegacyEtsyListing(oldListing, summary, mappings);
        if (!candidate || dryRun) continue;
        const result = await upsertListingAndVariant(candidate);
        if (result.listingCreated) summary.createdCount += 1;
        else summary.raceExistingCount += 1;
        if (result.variantCreated) summary.createdVariantCount += 1;
        if (result.variantExisting) summary.existingVariantCount += 1;
        if (result.variantSkipped) summary.skippedVariantCount += 1;
      }
    }

    return summary;
  } finally {
    await oldConnection.close();
  }
}

async function writeOutput(summary, outPath) {
  if (!outPath) return;
  await fs.promises.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await fs.promises.writeFile(path.resolve(outPath), `${JSON.stringify(summary, null, 2)}\n`);
}

async function main() {
  const args = parseArgs();
  const dryRun = String(args.dryRun).toLowerCase() !== 'false';
  await connectDatabase();
  try {
    const summary = await migrateLegacyListings({
      dryRun,
      limit: args.limit,
      oldEnv: path.resolve(args.oldEnv),
      asin: args.asin,
      source: args.source,
      mappings: readJsonFile(args.map),
    });
    await writeOutput(summary, args.out);
    logger.info('legacy_listing_migration_complete', summary);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('legacy_listing_migration_failed', error);
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assessLegacyAmazonListing,
  assessLegacyEtsyListing,
  buildListingPayload,
  emptySummary,
  migrateLegacyListings,
  parseArgs,
};
