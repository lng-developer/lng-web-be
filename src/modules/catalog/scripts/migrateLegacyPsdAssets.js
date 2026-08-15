const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Listing = require('../models/listing.model');
const MediaAsset = require('../../media/models/mediaAsset.model');
const { psdTemplateUpload } = require('../constants/catalog.constants');

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
    oldEnv: DEFAULT_OLD_ENV_FILE,
    limit: null,
    source: 'all',
  });
}

function readEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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

function normalizeUpper(value) {
  const text = String(value || '').trim().toUpperCase();
  return text || null;
}

function addSample(samples, key, row) {
  if (!samples[key]) samples[key] = [];
  if (samples[key].length < SAMPLE_LIMIT) samples[key].push(row);
}

function buildDesignKey(asin, ext = '.zip') {
  const safeAsin = normalizeUpper(asin);
  const safeExt = String(ext || '.zip').trim().toLowerCase();
  return safeAsin ? `psd/${safeAsin}/${safeAsin}${safeExt}` : null;
}

function mimeForExtension(ext) {
  if (ext === '.zip') return 'application/zip';
  if (ext === '.rar') return 'application/x-rar-compressed';
  return 'application/octet-stream';
}

function normalizeLegacyPsd(row, source) {
  if (source === 'ETSY') {
    const file = row.designFile || {};
    const ext = String(file.fileExt || '.zip').trim().toLowerCase();
    return {
      source,
      match: { etsyListingId: String(row.listingId || '').trim() || null, sku: normalizeUpper(row.SKU || row.sku || row.skus?.[0]) },
      key: String(file.key || '').trim() || null,
      originalFilename: String(file.fileName || '').trim() || null,
      ext,
      mimeType: String(file.mime || '').trim() || mimeForExtension(ext),
      size: Number.isInteger(file.size) && file.size >= 0 ? file.size : 0,
      secureUrl: String(file.url || '').trim() || null,
      legacyId: String(row._id || ''),
    };
  }

  const psd = row.psd || {};
  const asin = normalizeUpper(row.asin || psd.psd_id);
  const ext = String(psd.file_ext || '.zip').trim().toLowerCase();
  return {
    source,
    match: { asin },
    key: buildDesignKey(asin, ext),
    originalFilename: String(psd.file_name || '').trim() || (asin ? `${asin}${ext}` : null),
    ext,
    mimeType: String(psd.mime || '').trim() || mimeForExtension(ext),
    size: Number.isInteger(psd.size) && psd.size >= 0 ? psd.size : 0,
    secureUrl: String(psd.url || '').trim() || null,
    legacyId: String(row._id || ''),
  };
}

function isSupportedPsd(psd) {
  return psd.key
    && psd.originalFilename
    && psdTemplateUpload.allowedExtensions.includes(psd.ext)
    && (!psd.mimeType || psdTemplateUpload.allowedMimeTypes.includes(psd.mimeType));
}

async function loadListingMap(psds = [], source) {
  if (!psds.length) return new Map();
  const map = new Map();
  if (source === 'AMAZON') {
    const asins = [...new Set(psds.map((psd) => psd.match.asin).filter(Boolean))];
    const listings = await Listing.find({ salesChannelCode: 'AMAZON', asin: { $in: asins } })
      .select('_id shopId asin defaultPsdTemplateAssetId')
      .lean();
    for (const listing of listings) map.set(`asin:${listing.asin}`, listing);
    return map;
  }

  const etsyListingIds = [...new Set(psds.map((psd) => psd.match.etsyListingId).filter(Boolean))];
  const skus = [...new Set(psds.map((psd) => psd.match.sku).filter(Boolean))];
  if (!etsyListingIds.length && !skus.length) return map;
  const listings = await Listing.find({
    salesChannelCode: 'ETSY',
    $or: [
      ...(etsyListingIds.length ? [{ etsyListingId: { $in: etsyListingIds } }] : []),
      ...(skus.length ? [{ sku: { $in: skus } }] : []),
    ],
  }).select('_id shopId etsyListingId sku defaultPsdTemplateAssetId').lean();
  for (const listing of listings) {
    if (listing.etsyListingId) map.set(`etsyListingId:${listing.etsyListingId}`, listing);
    if (listing.sku) map.set(`sku:${listing.sku}`, listing);
  }
  return map;
}

async function loadMediaAssetMap(psds = []) {
  const keys = [...new Set(psds.map((psd) => psd.key).filter(Boolean))];
  if (!keys.length) return new Map();
  const assets = await MediaAsset.find({ provider: 'wasabi', providerAssetId: { $in: keys } }).select('_id providerAssetId').lean();
  return new Map(assets.map((asset) => [asset.providerAssetId, asset]));
}

function lookupListing(psd, listingMap) {
  if (psd.source === 'AMAZON') return listingMap.get(`asin:${psd.match.asin}`) || null;
  if (psd.match.etsyListingId) {
    const byId = listingMap.get(`etsyListingId:${psd.match.etsyListingId}`);
    if (byId) return byId;
  }
  return psd.match.sku ? listingMap.get(`sku:${psd.match.sku}`) || null : null;
}

async function findOrCreateMediaAsset(psd, listing, dryRun) {
  const existing = await MediaAsset.findOne({ provider: 'wasabi', providerAssetId: psd.key }).select('_id').lean();
  if (existing || dryRun) return { assetId: existing?._id || null, created: false, existing: Boolean(existing) };

  const created = await MediaAsset.create({
    originalFilename: psd.originalFilename,
    storageFilename: path.basename(psd.key),
    mimeType: psd.mimeType,
    size: psd.size,
    sha256: null,
    relativeStoragePath: psd.key,
    provider: 'wasabi',
    assetPurpose: 'PSD_TEMPLATE',
    uploadStatus: 'READY',
    providerAssetId: psd.key,
    resourceType: 'raw',
    secureUrl: psd.secureUrl,
    metadata: {
      migratedFrom: 'lng-website-v1',
      legacySource: psd.source,
      legacyId: psd.legacyId,
    },
    shopId: listing.shopId || null,
    ownerType: 'CATALOG_LISTING',
    ownerId: listing._id,
  });
  return { assetId: created._id, created: true, existing: false };
}

async function linkListing(listing, assetId, dryRun) {
  if (listing.defaultPsdTemplateAssetId) return false;
  if (!dryRun && assetId) {
    await Listing.updateOne(
      { _id: listing._id, defaultPsdTemplateAssetId: null },
      { $set: { defaultPsdTemplateAssetId: assetId } },
    );
  }
  return true;
}

function emptySummary(options = {}) {
  return {
    dryRun: options.dryRun,
    oldEnv: options.oldEnv,
    source: options.source,
    limit: options.limit || null,
    oldDatabase: null,
    newDatabase: null,
    scanned: 0,
    eligible: 0,
    unsupported: 0,
    missingMatch: 0,
    alreadyLinked: 0,
    mediaExisting: 0,
    mediaCreated: 0,
    linked: 0,
    wouldCreateMedia: 0,
    wouldLink: 0,
    samples: {},
  };
}

async function migrateRows(rows, source, summary, dryRun) {
  const psds = [];
  for (const row of rows) {
    summary.scanned += 1;
    const psd = normalizeLegacyPsd(row, source);
    if (!isSupportedPsd(psd)) {
      summary.unsupported += 1;
      addSample(summary.samples, 'unsupported', { source, legacyId: psd.legacyId, key: psd.key, filename: psd.originalFilename, mimeType: psd.mimeType });
      continue;
    }
    summary.eligible += 1;
    psds.push(psd);
  }

  const [listingMap, mediaMap] = await Promise.all([
    loadListingMap(psds, source),
    loadMediaAssetMap(psds),
  ]);

  for (const psd of psds) {
    const listing = lookupListing(psd, listingMap);
    if (!listing) {
      summary.missingMatch += 1;
      addSample(summary.samples, 'missingMatch', { source, legacyId: psd.legacyId, match: psd.match, key: psd.key });
      continue;
    }
    if (listing.defaultPsdTemplateAssetId) {
      summary.alreadyLinked += 1;
      continue;
    }

    const existingAsset = mediaMap.get(psd.key);
    const media = existingAsset
      ? { assetId: existingAsset._id, created: false, existing: true }
      : dryRun
        ? { assetId: null, created: false, existing: false }
      : await findOrCreateMediaAsset(psd, listing, dryRun);
    if (media.existing) summary.mediaExisting += 1;
    if (media.created) summary.mediaCreated += 1;
    if (dryRun && !media.existing) summary.wouldCreateMedia += 1;

    const linked = await linkListing(listing, media.assetId, dryRun);
    if (linked && dryRun) summary.wouldLink += 1;
    if (linked && !dryRun) summary.linked += 1;
  }
}

async function migrateLegacyPsdAssets(options = {}) {
  const dryRun = options.dryRun !== false;
  const oldEnv = options.oldEnv || DEFAULT_OLD_ENV_FILE;
  const source = String(options.source || 'all').toLowerCase();
  const limit = options.limit ? Number(options.limit) : null;
  const summary = emptySummary({ dryRun, oldEnv, source, limit });
  const legacyUri = options.legacyUri || legacyMongoUriFromEnv(oldEnv);
  if (!legacyUri) throw new Error(`Legacy Mongo URI not found in ${oldEnv}`);

  const legacyConnection = await mongoose.createConnection(legacyUri).asPromise();
  summary.oldDatabase = legacyConnection.name;
  summary.newDatabase = mongoose.connection.name;
  try {
    const queries = [];
    if (source === 'all' || source === 'amazon') {
      queries.push(['AMAZON', await legacyConnection.collection('listings')
        .find({ 'psd.status': /^available$/i })
        .project({ asin: 1, psd: 1 })
        .limit(limit || 0)
        .toArray()]);
    }
    if (source === 'all' || source === 'etsy') {
      queries.push(['ETSY', await legacyConnection.collection('etsylistings')
        .find({ PSDstatus: true })
        .project({ listingId: 1, SKU: 1, sku: 1, skus: 1, designFile: 1 })
        .limit(limit || 0)
        .toArray()]);
    }
    for (const [rowSource, rows] of queries) {
      await migrateRows(rows, rowSource, summary, dryRun);
    }
    return summary;
  } finally {
    await legacyConnection.close();
  }
}

async function main() {
  const args = parseArgs();
  const dryRun = !process.argv.includes('--apply') && !['false', '0'].includes(String(args.dryRun).toLowerCase());
  await connectDatabase();
  try {
    const summary = await migrateLegacyPsdAssets({
      dryRun,
      oldEnv: args.oldEnv,
      source: args.source,
      limit: args.limit,
    });
    logger.info('legacy_psd_asset_migration_complete', summary);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('legacy_psd_asset_migration_failed', error);
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildDesignKey,
  migrateLegacyPsdAssets,
  normalizeLegacyPsd,
};
