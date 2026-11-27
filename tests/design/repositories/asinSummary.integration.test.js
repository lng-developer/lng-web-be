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
