const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { reconcile } = require('../../tools/scripts/maintenance/reconcileListingSkuIndex');
const key = { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, sku: 1 };
const name = 'shopId_1_salesChannelCode_1_marketplaceCode_1_sku_1';
let server, client, collection;
beforeAll(async () => { server = await MongoMemoryServer.create(); client = await MongoClient.connect(server.getUri()); collection = client.db('listing_index_test').collection('listings'); }, 60000);
afterAll(async () => { await client?.close(); await server?.stop(); });
beforeEach(async () => {
  await collection.drop().catch(() => {});
  await collection.createIndex(key, { name, unique: true });
  for (const [channel, field] of [['ETSY', 'etsyListingId'], ['AMAZON', 'asin']]) {
    await collection.createIndex({ salesChannelCode: 1, marketplaceCode: 1, [field]: 1 }, { unique: true, partialFilterExpression: { salesChannelCode: channel, [field]: { $type: 'string', $gt: '' } } });
  }
});
test('repairs legacy SKU uniqueness while keeping separate Etsy identities and ASIN protection', async () => {
  const a = { shopId: 'shop', salesChannelCode: 'ETSY', marketplaceCode: 'ETSY_US', sku: 'SAME', etsyListingId: 'old' };
  await collection.insertOne({ ...a });
  await expect(collection.insertOne({ ...a, etsyListingId: 'new' })).rejects.toMatchObject({code:11000});
  await reconcile(collection);
  expect((await collection.indexes()).find(i => i.name === name).unique).toBe(true);
  await reconcile(collection, {apply:true});
  await collection.insertOne({...a, etsyListingId:'new'});
  await expect(collection.insertOne({...a, sku:'OTHER'})).rejects.toMatchObject({code:11000});
  const amazon = {shopId:'shop', salesChannelCode:'AMAZON', marketplaceCode:'US', sku:'AMZ', asin:'B0123'};
  await collection.insertOne({...amazon});
  await expect(collection.insertOne({...amazon, sku:'ANOTHER'})).rejects.toMatchObject({code:11000});
  expect(await reconcile(collection, {apply:true})).toMatchObject({changed:false});
  expect(await collection.countDocuments()).toBe(3);
});
test('refuses to weaken SKU constraint without canonical identity guard', async () => {
  await collection.dropIndex('salesChannelCode_1_marketplaceCode_1_etsyListingId_1');
  await expect(reconcile(collection,{apply:true})).rejects.toThrow(/identity/i);
  expect((await collection.indexes()).find(i=>i.name===name).unique).toBe(true);
});
