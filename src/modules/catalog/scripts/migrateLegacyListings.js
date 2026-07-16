const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Listing = require('../models/listing.model');
const {
  listingQcStatuses,
  recordStatuses,
  setupStatuses,
} = require('../constants/catalog.constants');

const DEFAULT_OLD_ENV_FILE = 'C:/lnd/lng-website/.env';
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
    duplicateIdentityCount: 0,
    hasLegacyPsdUrlCount: 0,
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

async function buildListingPayload({ oldListing, item, plan }) {
  const sku = normalizeUpper(item.sku);
  return {
    shopId: item.shopId,
    salesChannelCode: normalizeUpper(item.salesChannelCode),
    marketplaceCode: normalizeUpper(item.marketplaceCode),
    sku,
    asin: normalizeUpper(oldListing.asin),
    etsyListingId: null,
    title: String(item.title || oldListing.asin || sku).trim(),
    productTypeGroupId: plan.productTypeGroupId,
    internalTemplateId: plan.internalTemplateId || null,
    psdTemplateAssetId: null,
    baseCostAmount: 0,
    currency: item.price?.currency || 'USD',
    costCenterStatus: plan.vendorCostCenterId ? setupStatuses.PRESENT : setupStatuses.MISSING,
    psdStatus: setupStatuses.MISSING,
    status: recordStatuses.ACTIVE,
    qcStatus: listingQcStatuses.APPROVED,
    approvedBy: null,
    approvedAt: new Date(),
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  };
}

async function assessLegacyListing(oldListing, summary) {
  const legacyId = toId(oldListing);
  const asin = normalizeUpper(oldListing.asin);
  if (!asin) {
    summary.missingAsinCount += 1;
    addSample(summary.samples, 'missingAsin', { legacyId });
    return null;
  }

  if (oldListing.psd?.url) summary.hasLegacyPsdUrlCount += 1;

  const item = await findOrderItemByAsin(asin);
  if (!item) {
    summary.missingOrderItemCount += 1;
    addSample(summary.samples, 'missingOrderItem', { legacyId, asin });
    return null;
  }

  if (!normalizeUpper(item.sku)) {
    summary.missingSkuCount += 1;
    addSample(summary.samples, 'missingSku', { legacyId, asin, orderItemId: toId(item) });
    return null;
  }

  const plan = await findFulfillmentPlanByOrderItemId(item._id);
  if (!plan) {
    summary.missingFulfillmentPlanCount += 1;
    addSample(summary.samples, 'missingFulfillmentPlan', {
      legacyId,
      asin,
      orderItemId: toId(item),
      sku: item.sku,
    });
    return null;
  }

  if (!plan.productTypeGroupId) {
    summary.missingProductTypeGroupCount += 1;
    addSample(summary.samples, 'missingProductTypeGroup', {
      legacyId,
      asin,
      orderItemId: toId(item),
      fulfillmentPlanId: toId(plan),
    });
    return null;
  }

  const payload = await buildListingPayload({ oldListing, item, plan });
  const identity = {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    sku: payload.sku,
  };
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
    productTypeGroupId: toId(plan.productTypeGroupId),
    internalTemplateId: toId(plan.internalTemplateId),
    hasLegacyPsdUrl: Boolean(oldListing.psd?.url),
  });

  return { identity, payload };
}

async function migrateLegacyListings({
  dryRun = true,
  limit = null,
  oldEnv = DEFAULT_OLD_ENV_FILE,
  asin = null,
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
    const legacyFilter = normalizedAsin
      ? { asin: { $regex: `^${escapeRegex(normalizedAsin)}$`, $options: 'i' } }
      : {};
    let cursor = oldConnection.db.collection('listings')
      .find(legacyFilter)
      .sort({ _id: 1 });
    const numericLimit = Number(limit);
    if (Number.isInteger(numericLimit) && numericLimit > 0) cursor = cursor.limit(numericLimit);

    for await (const oldListing of cursor) {
      summary.scanned += 1;
      const candidate = await assessLegacyListing(oldListing, summary);
      if (!candidate || dryRun) continue;

      const result = await Listing.updateOne(
        candidate.identity,
        { $setOnInsert: candidate.payload },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );
      if (result.upsertedCount > 0) {
        summary.createdCount += 1;
      } else {
        summary.raceExistingCount += 1;
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
  assessLegacyListing,
  buildListingPayload,
  emptySummary,
  migrateLegacyListings,
  parseArgs,
};
