const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const Listing = require('../models/listing.model');
const orderPublic = require('../../order/public');
const mappingPublic = require('../../mapping/public');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => {
    const [key, ...values] = arg.replace(/^--/, '').split('=');
    return key ? { ...args, [key]: values.length ? values.join('=') : true } : args;
  }, {});
}

function normalize(value) {
  return String(value || '').trim().toUpperCase() || null;
}

function required(value, name) {
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function parseSkus(value) {
  const skus = [...new Set(String(required(value, 'skus')).split(',').map(normalize).filter(Boolean))];
  if (!skus.length) throw new Error('Missing required --skus');
  return skus;
}

function mergedSku(draftId) {
  return `MERGED-${String(draftId).toUpperCase()}`;
}

async function inspectSku({ shopId, sku }) {
  const draft = await Listing.findOne({
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'US',
    sku,
    status: 'ACTIVE',
    qcStatus: 'DRAFT',
    $or: [{ asin: null }, { asin: '' }],
  }).lean();
  if (!draft) return { sku, action: 'SKIP', reason: 'DRAFT_NOT_FOUND' };

  let asins = [...new Set((await orderPublic.findDistinctAsinsByListingId(draft._id)).map(normalize).filter(Boolean))];
  let asinSource = 'LINKED_ORDER_ITEM';
  if (!asins.length) {
    asins = [...new Set((await orderPublic.findDistinctAsins({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      sku,
    })).map(normalize).filter(Boolean))];
    asinSource = 'SHOP_SKU_HISTORY';
  }
  if (asins.length !== 1) return { sku, draftId: String(draft._id), action: 'SKIP', reason: asins.length ? 'AMBIGUOUS_ASIN' : 'ASIN_NOT_FOUND', asins };

  const [asin] = asins;
  const canonical = await Listing.findOne({
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'US',
    asin,
    status: 'ACTIVE',
    qcStatus: 'APPROVED',
  }).lean();
  if (!canonical || String(canonical.shopId) !== String(shopId)) {
    return { sku, draftId: String(draft._id), asin, action: 'SKIP', reason: 'CANONICAL_LISTING_NOT_FOUND' };
  }
  if (![asin, sku].includes(normalize(canonical.sku))) {
    return { sku, draftId: String(draft._id), asin, canonicalId: String(canonical._id), action: 'SKIP', reason: 'CANONICAL_SKU_NOT_FALLBACK' };
  }

  const plans = await mappingPublic.listFulfillmentPlansByListingId(draft._id);
  if (plans.some((plan) => plan.status === 'CONFIRMED')) {
    return { sku, draftId: String(draft._id), asin, canonicalId: String(canonical._id), action: 'SKIP', reason: 'CONFIRMED_PLAN' };
  }
  const orderItemCount = await orderPublic.countItemsByListingId(draft._id);
  return { sku, asin, asinSource, draft, canonical, orderItemCount, planCount: plans.length, action: 'MERGE' };
}

async function mergeCandidate(candidate, session) {
  const { draft, canonical, asin, sku } = candidate;
  const archivedSku = mergedSku(draft._id);
  const draftUpdate = await Listing.updateOne(
    { _id: draft._id, sku, status: 'ACTIVE', qcStatus: 'DRAFT', $or: [{ asin: null }, { asin: '' }] },
    { $set: { sku: archivedSku, status: 'INACTIVE' } },
    { session },
  );
  if (draftUpdate.modifiedCount !== 1) throw new Error(`Draft listing changed before merge: ${draft._id}`);
  if (normalize(canonical.sku) === asin) {
    const updated = await Listing.updateOne(
      { _id: canonical._id, asin, sku: asin, status: 'ACTIVE', qcStatus: 'APPROVED' },
      { $set: { sku } },
      { session },
    );
    if (updated.modifiedCount !== 1) throw new Error(`Canonical listing changed before merge: ${canonical._id}`);
  }

  const [items, plans] = await Promise.all([
    orderPublic.relinkItemsForCatalogMerge({ fromListingId: draft._id, toListingId: canonical._id, asin }, { session }),
    mappingPublic.relinkFulfillmentPlansForCatalogMerge({
      fromListingId: draft._id,
      toListingId: canonical._id,
      listing: { id: canonical._id, sku, title: canonical.title },
    }, { session }),
  ]);
  return {
    sku,
    asin,
    draftId: String(draft._id),
    archivedSku,
    canonicalId: String(canonical._id),
    orderItemsRelinked: items.modifiedCount,
    fulfillmentPlansRelinked: plans.modifiedCount,
    canonicalSkuRepaired: normalize(canonical.sku) === asin,
  };
}

async function mergeAsinFallbackListings({ shopId, skus, dryRun = true } = {}) {
  required(shopId, 'shopId');
  const candidates = await Promise.all(skus.map((sku) => inspectSku({ shopId, sku })));
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    dryRun,
    requested: skus.length,
    merged: [],
    skipped: candidates.filter((candidate) => candidate.action === 'SKIP').map(({ draft, canonical, ...candidate }) => candidate),
  };
  if (dryRun) {
    summary.wouldMerge = candidates.filter((candidate) => candidate.action === 'MERGE').map(({ draft, canonical, ...candidate }) => ({
      ...candidate,
      draftId: String(draft._id),
      canonicalId: String(canonical._id),
      canonicalSkuRepaired: normalize(canonical.sku) === candidate.asin,
    }));
    return summary;
  }

  for (const candidate of candidates.filter((item) => item.action === 'MERGE')) {
    const session = await mongoose.startSession();
    try {
      let merged;
      await session.withTransaction(async () => { merged = await mergeCandidate(candidate, session); });
      summary.merged.push(merged);
    } finally {
      await session.endSession();
    }
  }
  return summary;
}

async function main() {
  const args = parseArgs();
  const shopId = required(args.shopId, 'shopId');
  const skus = parseSkus(args.skus);
  await connectDatabase();
  try {
    const summary = await mergeAsinFallbackListings({ shopId, skus, dryRun: !args.apply });
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

module.exports = { inspectSku, mergeAsinFallbackListings, parseArgs, parseSkus };
