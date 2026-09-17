const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');

async function findRepairableLinks() {
  return mongoose.connection.db.collection('orderitems').aggregate([
    { $match: { listingId: null, asin: { $type: 'string', $gt: '' } } },
    { $lookup: { from: 'fulfillmentplans', localField: '_id', foreignField: 'orderItemId', as: 'plan' } },
    { $unwind: '$plan' },
    { $match: { 'plan.listingId': { $ne: null } } },
    { $lookup: { from: 'listings', localField: 'plan.listingId', foreignField: '_id', as: 'listing' } },
    { $unwind: '$listing' },
    { $match: { $expr: { $and: [
      { $eq: ['$shopId', '$listing.shopId'] },
      { $eq: ['$salesChannelCode', '$listing.salesChannelCode'] },
      { $eq: ['$marketplaceCode', '$listing.marketplaceCode'] },
      { $eq: ['$asin', '$listing.asin'] },
    ] } } },
    { $project: { _id: 1, asin: 1, quantity: 1, listingId: '$plan.listingId' } },
  ]).toArray();
}

async function repairOrderItemListingLinks({ dryRun = true } = {}) {
  const links = await findRepairableLinks();
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    dryRun,
    eligibleOrderItems: links.length,
    quantitySold: links.reduce((total, link) => total + (link.quantity || 0), 0),
    uniqueAsins: new Set(links.map((link) => link.asin)).size,
  };
  if (dryRun) return { ...summary, sample: links.slice(0, 20).map((link) => ({ orderItemId: String(link._id), asin: link.asin, listingId: String(link.listingId) })) };

  const result = await mongoose.connection.db.collection('orderitems').bulkWrite(
    links.map((link) => ({
      updateOne: {
        filter: { _id: link._id, listingId: null, asin: link.asin },
        update: { $set: { listingId: link.listingId, updatedAt: new Date() } },
      },
    })),
    { ordered: false },
  );
  return { ...summary, relinkedOrderItems: result.modifiedCount };
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  await connectDatabase();
  try {
    process.stdout.write(`${JSON.stringify(await repairOrderItemListingLinks({ dryRun }), null, 2)}\n`);
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

module.exports = { findRepairableLinks, repairOrderItemListingLinks };
