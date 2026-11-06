'use strict';

const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');

function parseArgs(args = []) {
  const options = {
    apply: false,
    batchSize: 500,
    vendorCode: null,
  };

  for (const arg of args) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--batch-size=')) {
      const size = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isInteger(size) && size > 0) {
        options.batchSize = size;
      }
    } else if (arg.startsWith('--vendor=')) {
      options.vendorCode = arg.split('=')[1].trim().toUpperCase();
    }
  }

  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  console.log('='.repeat(60));
  console.log(' BACKFILL DOMESTIC SHIPPING FROM INTERNATIONAL SCRIPT');
  console.log('='.repeat(60));
  console.log(` Mode:        ${options.apply ? 'APPLY (LIVE WRITE)' : 'DRY-RUN (SIMULATION ONLY)'}`);
  console.log(` Batch Size:  ${options.batchSize}`);
  if (options.vendorCode) {
    console.log(` Target Vendor: ${options.vendorCode}`);
  }

  await connectDatabase();
  const db = mongoose.connection.db;
  console.log(` Target DB:   ${db.databaseName}`);
  console.log('='.repeat(60));

  const vendors = await db.collection('vendors').find({}).toArray();
  const vendorMap = new Map(vendors.map((v) => [String(v._id), v.code || v.name]));
  const vendorIdByCode = new Map(vendors.map((v) => [String(v.code || '').toUpperCase(), v._id]));

  const query = {
    'internationalShipping.economyAmount': { $gt: 0 },
    $or: [
      { 'domesticShipping.economyAmount': { $exists: false } },
      { 'domesticShipping.economyAmount': null },
      { 'domesticShipping.economyAmount': { $lte: 0 } },
    ],
  };

  if (options.vendorCode) {
    const targetVendorId = vendorIdByCode.get(options.vendorCode);
    if (!targetVendorId) {
      console.error(`Vendor code "${options.vendorCode}" not found in database!`);
      return;
    }
    query.vendorId = targetVendorId;
  }

  const totalMatching = await db.collection('vendorcostcenters').countDocuments(query);
  console.log(`\nFound ${totalMatching} cost center(s) eligible for domestic shipping backfill.`);

  if (totalMatching === 0) {
    console.log('No documents need updating. Exiting.');
    return;
  }

  const cursor = db.collection('vendorcostcenters')
    .find(query, {
      projection: {
        _id: 1,
        vendorId: 1,
        code: 1,
        'internationalShipping.economyAmount': 1,
        'internationalShipping.additionalAmount': 1,
        'domesticShipping.economyAmount': 1,
        'domesticShipping.additionalAmount': 1,
      },
    })
    .sort({ _id: 1 });

  let batch = [];
  let processedCount = 0;
  let batchIndex = 0;
  const vendorStats = new Map();

  const totalBatches = Math.ceil(totalMatching / options.batchSize);

  for await (const doc of cursor) {
    const vId = String(doc.vendorId);
    const vCode = vendorMap.get(vId) || 'UNKNOWN';
    vendorStats.set(vCode, (vendorStats.get(vCode) || 0) + 1);

    const intl = doc.internationalShipping || {};
    const economyAmount = Number.isInteger(intl.economyAmount) ? intl.economyAmount : 0;
    const additionalAmount = Number.isInteger(intl.additionalAmount) ? intl.additionalAmount : 0;

    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            'domesticShipping.economyAmount': economyAmount,
            'domesticShipping.additionalAmount': additionalAmount,
          },
        },
      },
    });

    if (batch.length >= options.batchSize) {
      batchIndex += 1;
      processedCount += batch.length;

      if (options.apply) {
        await db.collection('vendorcostcenters').bulkWrite(batch, { ordered: false });
      }

      const percent = ((processedCount / totalMatching) * 100).toFixed(1);
      console.log(`[Batch ${batchIndex}/${totalBatches}] ${options.apply ? 'Updated' : 'Scanned'} ${processedCount}/${totalMatching} (${percent}%) cost centers...`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    batchIndex += 1;
    processedCount += batch.length;

    if (options.apply) {
      await db.collection('vendorcostcenters').bulkWrite(batch, { ordered: false });
    }

    const percent = ((processedCount / totalMatching) * 100).toFixed(1);
    console.log(`[Batch ${batchIndex}/${totalBatches}] ${options.apply ? 'Updated' : 'Scanned'} ${processedCount}/${totalMatching} (${percent}%) cost centers...`);
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(60));
  console.log(' EXECUTION SUMMARY');
  console.log('='.repeat(60));
  console.log(` Target DB:        ${db.databaseName}`);
  console.log(` Status:           ${options.apply ? 'APPLIED SUCCESSFULLY' : 'DRY-RUN COMPLETE (No writes occurred)'}`);
  console.log(` Total Processed:  ${processedCount} cost center(s) across ${batchIndex} batch(es)`);
  console.log(` Execution Time:   ${durationSec}s`);
  console.log('\n Breakdown by Vendor:');
  for (const [vCode, count] of vendorStats.entries()) {
    console.log(`   - ${vCode.padEnd(16)}: ${count} cost centers`);
  }
  console.log('='.repeat(60));

  if (!options.apply) {
    console.log('\n💡 Tip: To apply these changes to the database, run:');
    console.log('   node src/modules/vendor/scripts/backfillDomesticShippingFromInternational.js --apply\n');
  }
}

run()
  .catch((error) => {
    console.error('Migration failed with error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
