const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const repository = require('../../../src/modules/listingLaunch/repositories/listingLaunch.repository');

let mongo;
const shopId = '660000000000000000000001';
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_launch_repository_test' });
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('lean reads, scoped pagination and atomic once-only selection', async () => {
  const draft = await repository.create({ shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', brief: 'Floral tee' });
  await repository.create({ shopId: '660000000000000000000002', salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', brief: 'Other shop' });
  const result = await repository.list({ shopIds: [shopId], state: 'BRIEF', page: 1, limit: 20 });
  expect(result.total).toBe(1);
  expect(result.items[0]).not.toHaveProperty('$__');
  expect(await repository.findById(draft._id)).not.toHaveProperty('$__');
  expect((await repository.list({ shopIds: [], shopId })).total).toBe(0);
  expect((await repository.list({ shopIds: [shopId], shopId: '660000000000000000000002' })).total).toBe(0);
  const selections = await Promise.all([1, 2].map(() => repository.selectProduct(draft._id, {
    productTypeGroupId: '660000000000000000000003', internalTemplateId: '660000000000000000000004', selectedAt: new Date(),
  })));
  expect(selections.filter(Boolean)).toHaveLength(1);
  expect((await repository.findById(draft._id)).state).toBe('PRODUCT_SELECTED');
  const edited = await repository.update(draft._id, { brief: 'Updated brief' });
  expect(edited.state).toBe('PRODUCT_SELECTED');
  expect(edited.brief).toBe('Updated brief');
});
