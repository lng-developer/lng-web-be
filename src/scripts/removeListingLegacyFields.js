const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../shared/utils/logger');
const Listing = require('../modules/catalog/models/listing.model');

const LEGACY_FIELDS = [
  'productTypeGroupId',
  'internalTemplateId',
  'psdTemplateAssetId',
  'previewAssetId',
  'psdStatus',
  'costCenterStatus',
];

function isLegacyIndex(index) {
  return Object.keys(index.key || {}).some((field) => LEGACY_FIELDS.includes(field));
}

async function removeListingLegacyFields({ dryRun = true } = {}) {
  const fieldCounts = Object.fromEntries(await Promise.all(LEGACY_FIELDS.map(async (field) => [
    field,
    await Listing.collection.countDocuments({ [field]: { $exists: true } }),
  ])));
  const indexes = (await Listing.collection.indexes()).filter(isLegacyIndex).map((index) => index.name);
  if (!dryRun) {
    await Listing.collection.updateMany({}, { $unset: Object.fromEntries(LEGACY_FIELDS.map((field) => [field, ''])) });
    for (const indexName of indexes) await Listing.collection.dropIndex(indexName);
  }

  return { dryRun, fieldCounts, legacyIndexes: indexes };
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  await connectDatabase();
  try {
    const summary = await removeListingLegacyFields({ dryRun });
    logger.info('listing_legacy_fields_cleanup_complete', summary);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('listing_legacy_fields_cleanup_failed', error);
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { LEGACY_FIELDS, isLegacyIndex, removeListingLegacyFields };
