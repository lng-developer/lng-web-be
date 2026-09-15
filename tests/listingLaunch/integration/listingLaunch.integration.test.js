const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Shop = require('../../../src/modules/shop/models/shop.model');
const ProductTypeGroup = require('../../../src/modules/catalog/models/productTypeGroup.model');
const InternalTemplate = require('../../../src/modules/catalog/models/internalTemplate.model');
const Listing = require('../../../src/modules/catalog/models/listing.model');
const ListingVariant = require('../../../src/modules/catalog/models/listingVariant.model');
const service = require('../../../src/modules/listingLaunch/services/listingLaunch.service');

let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_launch_integration_test' });
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('real public ports select a populated Catalog template and leave Catalog records unchanged', async () => {
  const shop = await Shop.create({ name: 'Launch pilot' });
  const otherShop = await Shop.create({ name: 'Other pilot' });
  const group = await ProductTypeGroup.create({ code: 'LAUNCH_TEE', name: 'T-shirt' });
  const template = await InternalTemplate.create({ code: 'LAUNCH_TEE_MAIN', name: 'Front', productTypeGroupId: group._id });
  const auth = {
    accountId: new mongoose.Types.ObjectId().toString(),
    scopes: [{ scopeType: 'shop', scopeId: shop.id, permissions: ['CATALOG:WRITE'] }],
  };
  const draft = await service.createListingLaunch({ shopId: shop.id, marketplaceCode: 'AMAZON_US', brief: 'Floral tee' }, auth);
  await service.createListingLaunch({ shopId: otherShop.id, marketplaceCode: 'AMAZON_US', brief: 'Other tee' }, { permissions: ['CATALOG:WRITE'] });
  const attempts = await Promise.allSettled([1, 2].map(() => service.selectProduct(draft.id, {
    productTypeGroupId: group.id, internalTemplateId: template.id,
  }, auth)));
  expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.find((result) => result.status === 'rejected').reason.statusCode).toBe(409);
  const selected = await service.getListingLaunch(draft.id, auth);
  expect(selected).toMatchObject({ state: 'PRODUCT_SELECTED', productTypeGroupId: group.id, internalTemplateId: template.id, selectedBy: auth.accountId });
  expect(selected.selectedAt).toBeInstanceOf(Date);
  const edited = await service.updateListingLaunch(draft.id, { workingTitle: 'Updated pilot' }, auth);
  expect(edited).toMatchObject({ state: 'PRODUCT_SELECTED', workingTitle: 'Updated pilot' });
  const list = await service.listListingLaunches({}, auth);
  expect(list.total).toBe(1);
  expect(list.items.map((item) => item.id)).toEqual([draft.id]);
  await expect(service.getListingLaunch(draft.id, { scopes: [] })).rejects.toMatchObject({ statusCode: 403 });
  expect(await Listing.countDocuments()).toBe(0);
  expect(await ListingVariant.countDocuments()).toBe(0);
});
