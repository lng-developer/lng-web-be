const SKU_KEY = { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, sku: 1 };
const SKU_NAME = 'shopId_1_salesChannelCode_1_marketplaceCode_1_sku_1';
const TEMP_NAME = 'listing_sku_lookup_reconciliation';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function reconcile(collection, { apply = false } = {}) {
  const indexes = await collection.indexes();
  for (const [channel, field] of [['ETSY', 'etsyListingId'], ['AMAZON', 'asin']]) {
    if (!indexes.some(i => i.unique && equal(i.key, { salesChannelCode: 1, marketplaceCode: 1, [field]: 1 })
      && equal(i.partialFilterExpression, { salesChannelCode: channel, [field]: { $type: 'string', $gt: '' } }))) {
      throw new Error(`Missing canonical ${channel} identity index`);
    }
  }
  const current = indexes.find(i => i.name === SKU_NAME);
  if (current && (!equal(current.key, SKU_KEY) || current.partialFilterExpression || current.sparse || current.collation)) throw new Error('Unexpected SKU index definition');
  if (current && !current.unique) return { changed: false, index: SKU_NAME };
  if (!apply) return { changed: false, planned: 'REPLACE_LEGACY_UNIQUE_SKU', index: SKU_NAME };
  // Keep a lookup index throughout the replacement; reruns finish interrupted migrations.
  await collection.createIndex({ ...SKU_KEY, _id: 1 }, { name: TEMP_NAME });
  if (current) await collection.dropIndex(SKU_NAME);
  await collection.createIndex(SKU_KEY, { name: SKU_NAME });
  await collection.dropIndex(TEMP_NAME);
  const final = (await collection.indexes()).find(i => i.name === SKU_NAME);
  if (!final || final.unique || !equal(final.key, SKU_KEY)) throw new Error('SKU index verification failed');
  return { changed: true, index: SKU_NAME };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--apply', '--database=lng_web_be'].includes(a))) throw new Error('Unknown argument');
  if (!args.includes('--database=lng_web_be')) throw new Error('Explicit --database=lng_web_be required');
  const mongoose = require('mongoose');
  const config = require('../../../src/config');
  await mongoose.connect(config.database.uri, { autoIndex: false, autoCreate: false, maxPoolSize: 2 });
  try {
    if (mongoose.connection.name !== 'lng_web_be') throw new Error('Unexpected database');
    process.stdout.write(`database=${mongoose.connection.name} mode=${args.includes('--apply') ? 'APPLY' : 'DRY_RUN'}\n`);
    const result = await reconcile(mongoose.connection.db.collection('listings'), { apply: args.includes('--apply') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { reconcile };
