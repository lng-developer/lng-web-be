const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const DesignTask = require('../../../src/modules/design/models/designTask.model');
const ProductionTask = require('../../../src/modules/production/models/productionTask.model');
const design = require('../../../src/modules/design/repositories/designTask.repository');
const production = require('../../../src/modules/production/repositories/productionTask.repository');

let server;
const id = () => new mongoose.Types.ObjectId();
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false, autoCreate: false });
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });

test('groups all matching design tasks before pagination and counts actual output slots within listing/shop/seller scope', async () => {
  const listingId = id(); const shopId = id(); const otherShop = id(); const sourceListing = id();
  const task = (asin, extra = {}) => ({ listingId, shopId, taskType: 'PSD_TEMPLATE', status: 'OPEN',
    listingSnapshot: { asin, salesChannelCode: 'AMAZON' }, ...extra });
  await DesignTask.collection.insertMany([
    task('B002'), task('B001'), task('B001', { listingId: sourceListing, targetListingId: listingId }),
    task('B000', { taskType: 'MOCKUP' }), task(null),
    task('B000', { listingSnapshot: { asin: 'B000', salesChannelCode: 'ETSY' } }),
    task('B001', { shopId: otherShop }), task('B001', { status: 'CANCELLED' }),
  ]);
  const result = await design.listAsinGroups({ shopIds: [String(shopId)], status: 'OPEN', limit: 1 });
  expect(result).toMatchObject({ total: 2, page: 1, limit: 1, items: [{ _id: 'B001', taskCount: 2 }] });
  expect(result.items[0].listings).toHaveLength(1);
  const check = (extra = {}) => ({ sourceType: 'CUSTOMER_IMAGE', required: true, ...extra });
  const row = (extra = {}) => ({ shopId, listingSnapshot: { id: String(listingId) },
    orderItemSnapshot: { sku: 'J2502-ABC' }, status: 'NEED_SCALE', fulfillQty: 20,
    fileChecks: [check({ slotKey: 'front', outputAssetId: id() }), check({ slotKey: 'back' })], ...extra });
  await ProductionTask.collection.insertMany([
    row(), row({ listingSnapshot: { _id: listingId }, fileChecks: [
      check({ required: false, outputAssetId: id(), scaleStatus: 'SCALED' }),
      check({ outputAssetId: id(), qcStatus: 'REJECTED' }),
      check({ outputAssetId: id(), blockers: ['QC_REJECTED'] }),
      check({ scaleStatus: 'NOT_REQUIRED' }),
      check({ required: false, scaleStatus: 'NOT_REQUIRED' }),
      { sourceType: 'PSD_TEMPLATE', required: true, inputAssetId: id() },
    ] }), row({ fileChecks: [] }), row({ shopId: otherShop }),
    row({ status: 'CANCELLED' }), row({ orderSnapshot: { status: 'CANCELLED' } }),
    row({ orderItemSnapshot: { sku: 'OTHER-ABC' } }), row({ orderItemSnapshot: { sku: 'J25020-ABC' } }),
  ]);
  const groups = result.items.map((group) => ({ asin: group._id, listings: group.listings }));
  expect(await production.summarizeScaleFilesByListings(groups, { sellerCode: 'J2502' })).toEqual([
    { asin: 'B001', productionTaskCount: 3, totalFileCount: 6, scaledFileCount: 2 },
  ]);
  expect(await production.summarizeScaleFilesByListings(groups, { sellerCode: '' })).toEqual([]);
  expect(await design.listAsinGroups({ shopIds: [] })).toMatchObject({ items: [], total: 0 });
  expect(await design.listAsinGroups({ shopId: String(shopId), status: 'OPEN', page: 2, limit: 1 }))
    .toMatchObject({ items: [{ _id: 'B002', taskCount: 1 }], total: 2 });
  expect(await design.listAsinGroups({ shopId: String(shopId), status: 'OPEN', sortOrder: 'desc', limit: 1 }))
    .toMatchObject({ items: [{ _id: 'B002', taskCount: 1 }], total: 2 });
  const allGroups = await design.listAsinGroups({ shopId: String(shopId), status: 'OPEN', limit: 1 }, { paginate: false });
  expect(allGroups.items.map((group) => group._id)).toEqual(['B001', 'B002']);
  const visibleGroups = await design.listAsinGroups({ shopId: String(shopId), status: 'OPEN', asins: ['B001'], page: 2, limit: 1 }, { paginate: false });
  expect(visibleGroups.items.map((group) => group._id)).toEqual(['B001']);
  expect(visibleGroups.items[0].taskCount).toBe(2);
  const unpagedTasks = await design.list({ shopId: String(shopId), status: 'OPEN', taskType: 'PSD_TEMPLATE',
    salesChannelCode: 'AMAZON', sortBy: 'totalFileCount', page: 2, limit: 1 }, { paginate: false });
  expect(unpagedTasks.items).toHaveLength(unpagedTasks.total);
  expect(unpagedTasks.items.length).toBeGreaterThan(1);
  expect(unpagedTasks).toMatchObject({ page: 2, limit: 1 });
  expect(await design.listAsinGroups({ asins: ['B001'], asin: 'B002' }, { paginate: false }))
    .toMatchObject({ items: [], total: 0 });
});


test('Etsy grouping uses its own external id and preserves shop, seller and status filters', async () => {
  const shopId = id(); const otherShop = id(); const listingId = id(); const amazonListing = id();
  const task = (extra = {}) => ({ listingId, shopId, taskType: 'PSD_TEMPLATE', status: 'OPEN',
    listingSnapshot: { etsyListingId: '123', salesChannelCode: 'ETSY' }, ...extra });
  await DesignTask.collection.insertMany([
    task(), task(), task({ shopId: otherShop }), task({ status: 'CANCELLED' }),
    task({ listingId: amazonListing, listingSnapshot: { asin: '123', salesChannelCode: 'AMAZON' } }),
  ]);
  const query = { shopIds: [String(shopId)], sellerListingIds: [String(listingId)], status: 'OPEN' };
  const options = { paginate: false, salesChannelCode: 'ETSY', externalIds: ['123'] };
  const groups = await design.listListingGroups(query, options);
  expect(groups).toMatchObject({ total: 1, items: [{ _id: '123', taskCount: 2 }] });
  expect(groups.items[0].listings).toEqual([{ listingId, shopId }]);
  expect(await design.listListingGroups({ ...query, etsyListingId: 'different' }, options)).toMatchObject({ total: 0 });
  await ProductionTask.collection.insertMany([
    { shopId, listingSnapshot: { id: String(listingId) }, status: 'NEED_SCALE', orderItemSnapshot: { sku: 'J2502-X' },
      fileChecks: [{ sourceType: 'CUSTOMER_IMAGE', required: true, outputAssetId: id() },
        { sourceType: 'CUSTOMER_IMAGE', required: true }] },
    { shopId, listingSnapshot: { id: String(amazonListing) }, status: 'NEED_SCALE', orderItemSnapshot: { sku: 'J2502-X' },
      fileChecks: [{ sourceType: 'CUSTOMER_IMAGE', required: true }] },
  ]);
  expect(await production.summarizeScaleFilesByListings(groups.items.map((group) => ({ asin: group._id, listings: group.listings })),
    { sellerCode: 'J2502' })).toEqual([{ asin: '123', productionTaskCount: 1, totalFileCount: 2, scaledFileCount: 1 }]);
});


test('counts one pending minimum for NEED_SCALE tasks without output checks, without changing explicit slots', async () => {
  const listingId = id(); const shopId = id();
  const row = (extra = {}) => ({ shopId, listingSnapshot: { id: String(listingId) },
    status: 'NEED_SCALE', scaleStatus: 'NEED_SCALE', templateSnapshot: null, fulfillQty: 20,
    fileChecks: [{ sourceType: 'PSD_TEMPLATE', required: true, inputAssetId: id() }], ...extra });
  const summarize = () => production.summarizeScaleFilesByListings([
    { asin: 'MISSING-SLOTS', listings: [{ listingId, shopId }] },
  ]);
  await ProductionTask.collection.insertMany([
    row(), row({ status: 'CANCELLED' }), row({ orderSnapshot: { status: 'CANCELLED' } }),
    row({ scaleStatus: 'NOT_REQUIRED' }), row({ scaleStatus: 'SCALED' }),
  ]);
  expect(await summarize()).toEqual([{ asin: 'MISSING-SLOTS', productionTaskCount: 3, totalFileCount: 1, scaledFileCount: 0 }]);
  await ProductionTask.collection.insertOne(row({ fileChecks: [
    { sourceType: 'CUSTOMER_IMAGE', slotKey: 'front', required: true, outputAssetId: id() },
    { sourceType: 'CUSTOMER_IMAGE', slotKey: 'back', required: true },
  ] }));
  expect(await summarize()).toEqual([{ asin: 'MISSING-SLOTS', productionTaskCount: 4, totalFileCount: 3, scaledFileCount: 1 }]);
});
