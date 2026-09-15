jest.mock('../../../src/modules/media/public', () => ({ getAsset: jest.fn() }));
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('../../../src/modules/listingLaunch/models/listingMockupAnalysisRun.model');
const inputs = require('../../../src/modules/listingLaunch/services/listingContentInput.service');
const media = require('../../../src/modules/media/public');
const { contentInputsSchema } = require('../../../src/modules/listingLaunch/validators/listingLaunch.validator');
const { launchPayload, snapshot } = require('../helpers/contentFixtures');
jest.setTimeout(30000);
let mongo;
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri()); }, 60000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); }, 60000);
test('legacy text snapshot keeps its literal hash', () => {
  const value = inputs.buildContentSnapshot(launchPayload(), snapshot.catalog);
  expect(Object.hasOwn(value, 'designContext')).toBe(false);
  expect(inputs.hashContentSnapshot(value)).toBe('ee858eb3990fe5d213e20dd27699bdb1bba3e53d0a08ae4a5325f376f37abd51');
});
test('image requires server-derived confirmation and replacement clears only design context', async () => {
  const assetId = new mongoose.Types.ObjectId();
  await require('../../../src/modules/shop/models/shop.model').create({ _id: launchPayload().shopId, name: 'Mockup confirmation test' });
  const launch = await Launch.create(launchPayload({ mockupAssetId: assetId, mockupRevision: 1 }));
  const identity = { accountId: new mongoose.Types.ObjectId().toString(), scopes: [{ scopeType: 'shop', scopeId: String(launch.shopId), permissions: ['CATALOG:WRITE'] }] };
  const command = { ...launchPayload().contentInputs, expectedInputVersion: 1 };
  delete command.confirmedBy; delete command.confirmedAt;
  await expect(inputs.saveContentInputs(String(launch._id), command, identity)).rejects.toMatchObject({ code: 'MOCKUP_CONFIRMATION_REQUIRED' });
  const run = await Run.create({ launchId: launch._id, shopId: launch.shopId, assetId, assetHash: 'a'.repeat(64), mockupRevision: 1, requestedBy: identity.accountId,
    requestKey: crypto.randomUUID(), requestHash: 'b'.repeat(64), model: 'test', provider: 'OPENAI', promptVersion: 1, status: 'SUCCEEDED',
    result: { detectedText: '', theme: '', designDescription: 'Cat', suggestedKeyword: 'Cat', warnings: [] } });
  media.getAsset.mockResolvedValue({ _id: assetId, sha256: run.assetHash, provider: 'cloudinary', deliveryType: 'authenticated', uploadStatus: 'READY',
    ownerType: 'LISTING_LAUNCH', ownerId: launch._id, shopId: launch.shopId, mimeType: 'image/jpeg', metadata: { width: 10, height: 10 }, size: 10 });
  command.mockupReview = { sourceAnalysisRunId: String(run._id), mockupConfirmed: true, detectedText: 'Corrected text', theme: 'Cat', designDescription: 'Seller corrected cat' };
  expect(contentInputsSchema.validate(command).error).toBeUndefined();
  const saved = await inputs.saveContentInputs(String(launch._id), command, identity);
  expect(saved.contentInputs.designContext).toMatchObject({ assetId: String(assetId), assetHash: run.assetHash, confirmedBy: identity.accountId, detectedText: 'Corrected text' });
  expect(saved.mockupConfirmationUsable).toBe(true);
  const repo = require('../../../src/modules/listingLaunch/repositories/listingLaunch.repository');
  await repo.replaceMockup(launch._id, { expectedMockupRevision: 1, expectedInputVersion: 2, assetId: new mongoose.Types.ObjectId() });
  const replaced = await Launch.findById(launch._id).lean();
  expect(replaced.contentInputs.designContext).toBeUndefined();
  expect(replaced.contentInputs.productFacts.material).toBe('Cotton');
  command.expectedInputVersion = 3;
  await expect(inputs.saveContentInputs(String(launch._id), command, identity)).rejects.toMatchObject({ code: 'MOCKUP_CONFIRMATION_REQUIRED' });
});
