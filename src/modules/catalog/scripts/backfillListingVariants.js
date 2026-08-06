const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Listing = require('../models/listing.model');
const ListingVariant = require('../models/listingVariant.model');

async function backfillListingVariants({ dryRun = true } = {}) {
  const listings = await Listing.collection.find(
    { productTypeGroupId: { $exists: true, $ne: null } },
    { projection: { productTypeGroupId: 1, internalTemplateId: 1, psdTemplateAssetId: 1, previewAssetId: 1, defaultVariantId: 1 } },
  ).toArray();
  const summary = { dryRun, eligible: listings.length, created: 0, existing: 0, defaultsSet: 0 };

  for (const listing of listings) {
    const filter = { listingId: listing._id, productTypeGroupId: listing.productTypeGroupId };
    let variant = await ListingVariant.findOne(filter).select('_id').lean();
    if (variant) summary.existing += 1;
    else if (!dryRun) {
      variant = await ListingVariant.create({
        ...filter,
        internalTemplateId: listing.internalTemplateId || null,
        psdTemplateAssetId: listing.psdTemplateAssetId || null,
        previewAssetId: listing.previewAssetId || null,
      });
      summary.created += 1;
    } else summary.created += 1;

    if (!listing.defaultVariantId && (dryRun || variant?._id)) {
      if (!dryRun) {
        await Listing.updateOne(
          { _id: listing._id, defaultVariantId: null },
          { defaultVariantId: variant._id },
        );
      }
      summary.defaultsSet += 1;
    }
  }
  return summary;
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  await connectDatabase();
  try {
    const summary = await backfillListingVariants({ dryRun });
    logger.info('listing_variant_backfill_complete', summary);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('listing_variant_backfill_failed', error);
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { backfillListingVariants };
