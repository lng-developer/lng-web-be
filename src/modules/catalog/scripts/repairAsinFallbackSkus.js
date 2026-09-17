const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const Listing = require('../models/listing.model');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((args, arg) => ({ ...args, [arg.replace(/^--/, '')]: true }), {});
}

async function findSafeCandidates() {
  return Listing.aggregate([
    {
      $match: {
        salesChannelCode: 'AMAZON',
        status: 'ACTIVE',
        qcStatus: 'APPROVED',
        asin: { $type: 'string', $gt: '' },
        $expr: { $eq: ['$sku', '$asin'] },
      },
    },
    {
      $lookup: {
        from: 'orderitems',
        let: { shopId: '$shopId', asin: '$asin', marketplaceCode: '$marketplaceCode' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$shopId', '$$shopId'] },
            { $eq: ['$salesChannelCode', 'AMAZON'] },
            { $eq: ['$marketplaceCode', '$$marketplaceCode'] },
            { $eq: ['$asin', '$$asin'] },
            { $ne: ['$sku', '$$asin'] },
          ] } } },
          { $group: { _id: '$sku' } },
        ],
        as: 'skuEvidence',
      },
    },
    { $match: { $expr: { $eq: [{ $size: '$skuEvidence' }, 1] } } },
    { $set: { sellerSku: { $arrayElemAt: ['$skuEvidence._id', 0] } } },
    {
      $lookup: {
        from: 'listings',
        let: { shopId: '$shopId', marketplaceCode: '$marketplaceCode', sellerSku: '$sellerSku', id: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$shopId', '$$shopId'] },
            { $eq: ['$salesChannelCode', 'AMAZON'] },
            { $eq: ['$marketplaceCode', '$$marketplaceCode'] },
            { $eq: ['$sku', '$$sellerSku'] },
            { $ne: ['$_id', '$$id'] },
          ] } } },
          { $limit: 1 },
        ],
        as: 'conflicts',
      },
    },
    { $match: { $expr: { $eq: [{ $size: '$conflicts' }, 0] } } },
    { $project: { _id: 1, asin: 1, sku: 1, sellerSku: 1 } },
  ]);
}

async function repairAsinFallbackSkus({ dryRun = true } = {}) {
  const candidates = await findSafeCandidates();
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    dryRun,
    candidates: candidates.length,
    repaired: [],
    failed: [],
  };
  if (dryRun) {
    summary.wouldRepair = candidates.map((candidate) => ({
      listingId: String(candidate._id), asin: candidate.asin, sellerSku: candidate.sellerSku,
    }));
    return summary;
  }

  for (const candidate of candidates) {
    try {
      const result = await Listing.updateOne(
        {
          _id: candidate._id,
          salesChannelCode: 'AMAZON',
          status: 'ACTIVE',
          qcStatus: 'APPROVED',
          asin: candidate.asin,
          sku: candidate.asin,
        },
        { $set: { sku: candidate.sellerSku } },
      );
      if (result.modifiedCount !== 1) throw new Error('Listing changed after preflight');
      summary.repaired.push({ listingId: String(candidate._id), asin: candidate.asin, sellerSku: candidate.sellerSku });
    } catch (error) {
      summary.failed.push({ listingId: String(candidate._id), asin: candidate.asin, error: error.message });
    }
  }
  return summary;
}

async function main() {
  const args = parseArgs();
  await connectDatabase();
  try {
    const summary = await repairAsinFallbackSkus({ dryRun: !args.apply });
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

module.exports = { findSafeCandidates, repairAsinFallbackSkus };
