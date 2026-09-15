const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const ListingLaunch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const listingLaunchService = require('../../../src/modules/listingLaunch/services/listingLaunch.service');
const {
  saveContentInputs,
  buildContentSnapshot,
  hashContentSnapshot,
} = require('../../../src/modules/listingLaunch/services/listingContentInput.service');

jest.setTimeout(30000);

const shopId = new mongoose.Types.ObjectId();
const otherShopId = new mongoose.Types.ObjectId();
const accountId = new mongoose.Types.ObjectId();
const productTypeGroupId = new mongoose.Types.ObjectId();
const internalTemplateId = new mongoose.Types.ObjectId();
const writer = {
  accountId: String(accountId),
  scopes: [{ scopeType: 'shop', scopeId: String(shopId), permissions: ['CATALOG:WRITE'] }],
};
const reader = {
  accountId: String(accountId),
  scopes: [{ scopeType: 'shop', scopeId: String(shopId), permissions: ['CATALOG:READ'] }],
};
const input = {
  expectedInputVersion: 0,
  profileCode: 'AMAZON_US_APPAREL_CONTENT_V1',
  keyword: '  Funny Cat Accountant  ',
  language: 'en-US',
  productFacts: {
    brand: '  LNG Studio  ',
    productName: '  Accountant Cat Shirt  ',
    material: '  100% cotton  ',
    features: ['  Crew neck  ', '  Short sleeve  '],
    personalization: '  Add a name  ',
    careInstructions: '  Machine wash cold  ',
  },
  availableColors: [
    { code: ' black ', label: ' Black ' },
    { code: 'navy', label: 'Navy' },
  ],
  factsConfirmed: true,
};

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_content_input_test' });
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
}, 60000);

beforeEach(async () => {
  await ListingLaunch.deleteMany({});
});

async function insertP1Launch(overrides = {}) {
  const now = new Date();
  const document = {
    _id: new mongoose.Types.ObjectId(),
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    brief: 'Create a factual cat-accountant shirt listing.',
    workingTitle: null,
    productTypeGroupId,
    internalTemplateId,
    referenceAssetIds: [],
    state: 'PRODUCT_SELECTED',
    selectedBy: accountId,
    selectedAt: now,
    createdBy: accountId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await ListingLaunch.collection.insertOne(document);
  return document;
}

test('saves complete confirmed inputs on a selected P1 launch and starts its missing version at one', async () => {
  const launch = await insertP1Launch();

  const result = await saveContentInputs(String(launch._id), input, writer);

  expect(result).toMatchObject({
    id: String(launch._id),
    contentInputVersion: 1,
    contentVersionCounter: 0,
    approvedContent: null,
    contentInputs: {
      profileCode: 'AMAZON_US_APPAREL_CONTENT_V1',
      keyword: 'Funny Cat Accountant',
      language: 'en-US',
      productFacts: {
        brand: 'LNG Studio',
        productName: 'Accountant Cat Shirt',
        material: '100% cotton',
        features: ['Crew neck', 'Short sleeve'],
        personalization: 'Add a name',
        careInstructions: 'Machine wash cold',
      },
      availableColors: [
        { code: 'BLACK', label: 'Black' },
        { code: 'NAVY', label: 'Navy' },
      ],
      factsConfirmed: true,
      confirmedBy: String(accountId),
      confirmedAt: expect.any(Date),
    },
  });
  expect(result).not.toHaveProperty('_id');
});

test('requires product selection and the supported marketplace/profile', async () => {
  const draft = await insertP1Launch({ state: 'BRIEF', productTypeGroupId: null, internalTemplateId: null });
  await expect(saveContentInputs(String(draft._id), input, writer)).rejects.toMatchObject({ statusCode: 409 });

  const unsupportedMarketplace = await insertP1Launch({ marketplaceCode: 'AMAZON_CA' });
  await expect(saveContentInputs(String(unsupportedMarketplace._id), input, writer)).rejects.toMatchObject({ statusCode: 409 });

  const selected = await insertP1Launch();
  await expect(saveContentInputs(String(selected._id), { ...input, profileCode: 'OTHER_PROFILE' }, writer))
    .rejects.toMatchObject({ statusCode: 409 });
});

test('requires exact-shop write access and rejects read-only access', async () => {
  const launch = await insertP1Launch();
  const wrongShopWriter = {
    accountId: String(accountId),
    scopes: [{ scopeType: 'shop', scopeId: String(otherShopId), permissions: ['CATALOG:WRITE'] }],
  };

  await expect(saveContentInputs(String(launch._id), input, wrongShopWriter)).rejects.toMatchObject({ statusCode: 403 });
  await expect(saveContentInputs(String(launch._id), input, reader)).rejects.toMatchObject({ statusCode: 403 });
});

test('rejects a stale expected input version without changing confirmed inputs', async () => {
  const launch = await insertP1Launch();
  await saveContentInputs(String(launch._id), input, writer);

  await expect(saveContentInputs(String(launch._id), input, writer)).rejects.toMatchObject({ statusCode: 409 });
  const stored = await ListingLaunch.findById(launch._id).lean();
  expect(stored.contentInputVersion).toBe(1);
  expect(stored.contentInputs.keyword).toBe('Funny Cat Accountant');
});

test('allows only one simultaneous save for the same expected version', async () => {
  const launch = await insertP1Launch();

  const results = await Promise.allSettled([
    saveContentInputs(String(launch._id), input, writer),
    saveContentInputs(String(launch._id), input, writer),
  ]);

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected').reason.statusCode).toBe(409);
  expect((await ListingLaunch.findById(launch._id).lean()).contentInputVersion).toBe(1);
});

test('brief edits increment the input version and clear approval while title/reference edits do neither', async () => {
  const versionId = new mongoose.Types.ObjectId();
  const launch = await insertP1Launch({
    contentInputVersion: 4,
    approvedContent: {
      versionId,
      inputVersion: 4,
      inputHash: 'a'.repeat(64),
      selectedColorCodes: ['BLACK'],
      approvedBy: accountId,
      approvedAt: new Date(),
    },
  });

  const cosmetic = await listingLaunchService.updateListingLaunch(String(launch._id), {
    workingTitle: 'Pilot title',
    referenceAssetIds: [],
  }, writer);
  expect(cosmetic.contentInputVersion).toBe(4);
  expect(cosmetic.approvedContent).toMatchObject({ versionId: String(versionId) });

  const invalidated = await listingLaunchService.updateListingLaunch(String(launch._id), {
    brief: 'Updated factual brief',
  }, writer);
  expect(invalidated.contentInputVersion).toBe(5);
  expect(invalidated.approvedContent).toBeNull();
});

test('builds an allowlisted canonical snapshot and hashes its exact JSON with SHA-256', () => {
  const launch = {
    marketplaceCode: 'AMAZON_US',
    brief: 'Factual brief',
    productTypeGroupId,
    internalTemplateId,
    contentInputs: {
      profileCode: 'AMAZON_US_APPAREL_CONTENT_V1',
      keyword: 'Funny Cat Accountant',
      language: 'en-US',
      productFacts: {
        brand: 'LNG Studio',
        productName: 'Accountant Cat Shirt',
        material: '100% cotton',
        features: ['Crew neck'],
      },
      availableColors: [{ code: 'BLACK', label: 'Black' }],
      factsConfirmed: true,
      confirmedBy: accountId,
      confirmedAt: new Date(),
    },
  };
  const snapshot = buildContentSnapshot(launch, {
    productTypeGroup: { code: 'TEE', name: 'T-shirt', printMethod: 'DTG', status: 'ACTIVE', mutableExtra: 'excluded' },
    internalTemplate: { code: 'TEE_FRONT', name: 'Front print', description: 'excluded', status: 'ACTIVE' },
  });
  const expected = {
    profileCode: 'AMAZON_US_APPAREL_CONTENT_V1',
    profileVersion: 1,
    marketplaceCode: 'AMAZON_US',
    brief: 'Factual brief',
    productTypeGroupId: String(productTypeGroupId),
    internalTemplateId: String(internalTemplateId),
    keyword: 'Funny Cat Accountant',
    language: 'en-US',
    productFacts: {
      brand: 'LNG Studio',
      productName: 'Accountant Cat Shirt',
      material: '100% cotton',
      features: ['Crew neck'],
      personalization: null,
      careInstructions: null,
    },
    availableColors: [{ code: 'BLACK', label: 'Black' }],
    catalog: {
      productTypeGroup: { code: 'TEE', name: 'T-shirt', printMethod: 'DTG' },
      internalTemplate: { code: 'TEE_FRONT', name: 'Front print' },
    },
  };

  expect(snapshot).toEqual(expected);
  expect(hashContentSnapshot(snapshot)).toBe(crypto.createHash('sha256').update(JSON.stringify(expected)).digest('hex'));
  expect(hashContentSnapshot(snapshot)).toMatch(/^[a-f\d]{64}$/);
});
